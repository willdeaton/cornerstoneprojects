/*
 * Shrink a photo in the browser, before it ever reaches a Server Action.
 *
 * Deliberately not 'server-only': this runs on the phone that took the picture.
 *
 * A current phone camera hands over 3-5 MB. That is most of the 10 MB action
 * cap on its own, and every byte of it then gets base64'd (a further +33%) into
 * a Postgres TEXT column and read back out for every view of the tab. A receipt
 * has to be legible, not archival — 1600px on the long edge reads every line of
 * a till roll and lands around 250-400 KB.
 *
 * Nothing here is allowed to stop a receipt being saved. A PDF, a format the
 * browser won't decode, a canvas that refuses to encode: every one of those
 * paths returns the original file and lets the upload proceed.
 */

export interface Downscaled {
  /** The image to store — re-encoded, or the original when that wasn't possible. */
  file: File;
  /** A ~20 KB copy for the table's thumbnail column, or null if none was made. */
  thumb: File | null;
}

export interface DownscaleOptions {
  /** Longest edge of the stored image, in pixels. */
  maxEdge?: number;
  /** JPEG quality for the stored image, 0-1. */
  quality?: number;
  /** Longest edge of the thumbnail, in pixels. */
  thumbEdge?: number;
  /** JPEG quality for the thumbnail. */
  thumbQuality?: number;
}

const DEFAULTS: Required<DownscaleOptions> = {
  maxEdge: 1600,
  quality: 0.72,
  thumbEdge: 320,
  thumbQuality: 0.6,
};

/** Small enough that re-encoding it would cost quality for no saving. */
const ALREADY_SMALL_BYTES = 400_000;

type Decoded = { width: number; height: number; draw: CanvasImageSource; release: () => void };

/**
 * Decode the file to something drawable.
 *
 * `imageOrientation: 'from-image'` matters more than it looks: without it a
 * portrait photo from a phone is stored on its side, because the rotation lives
 * in EXIF rather than in the pixels.
 */
async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: bitmap,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> path — Safari has historically been fussy
      // about createImageBitmap options.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: img,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

/** Draw at a bounded size and encode as JPEG. Null if the browser declines. */
async function render(
  src: Decoded,
  maxEdge: number,
  quality: number,
  name: string
): Promise<File | null> {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // JPEG has no alpha, so a transparent PNG would otherwise come out black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(src.draw, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
  );
  if (!blob) return null;
  return new File([blob], name, { type: 'image/jpeg' });
}

/**
 * Shrink a chosen receipt photo, and make a thumbnail alongside it.
 *
 * Anything that isn't a decodable image comes back untouched, subject to the
 * same 10 MB cap the action enforces.
 */
export async function downscaleImage(
  file: File,
  options: DownscaleOptions = {}
): Promise<Downscaled> {
  const opts = { ...DEFAULTS, ...options };

  // PDFs and anything non-image: nothing to do, and nothing to draw a thumb from.
  if (!file.type.startsWith('image/')) return { file, thumb: null };

  const src = await decode(file);
  if (!src) return { file, thumb: null };

  try {
    const stamp = Date.now();
    const alreadySmall =
      file.size < ALREADY_SMALL_BYTES && Math.max(src.width, src.height) <= opts.maxEdge;

    // A small image is kept as-is, but still gets a thumbnail — the table wants
    // one whatever the original size.
    const main = alreadySmall
      ? file
      : (await render(src, opts.maxEdge, opts.quality, `receipt-${stamp}.jpg`)) ?? file;

    const thumb = await render(
      src,
      opts.thumbEdge,
      opts.thumbQuality,
      `receipt-${stamp}-thumb.jpg`
    );

    // Re-encoding can lose to the original on an already-compressed photo.
    return { file: main.size < file.size ? main : file, thumb };
  } catch {
    return { file, thumb: null };
  } finally {
    src.release();
  }
}
