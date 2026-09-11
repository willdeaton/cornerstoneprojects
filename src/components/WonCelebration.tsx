'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The full-screen "we won it" moment, fired when a quote is marked sold.
 *
 * One of three hand-drawn reaction images is picked at random so the same face
 * doesn't greet you every time, confetti falls behind it, and the whole thing
 * clears itself after a couple of seconds. Clicking, or any key, cuts it short
 * — nobody should have to wait out a celebration to get back to work.
 *
 * `onDone` fires exactly once per showing, on whichever comes first. Callers
 * hang the follow-on work (the conversion, a refresh) off it, so the overlay is
 * never yanked out mid-animation by a redirect.
 */

/** Drop replacements in `public/celebration/` under these names. */
const IMAGES = [
  { src: '/celebration/won-1.png', alt: "That's what I'm talking about!" },
  { src: '/celebration/won-2.png', alt: 'Yay! We got work!' },
  { src: '/celebration/won-3.png', alt: 'Somebody load the truck!' },
];

const CONFETTI_COLORS = ['#98C73A', '#7BA82C', '#B4DC6A', '#F0A202', '#2F6FD0', '#FFFFFF'];

/** How long the overlay stays up on its own, in ms. */
const HOLD_MS = 2800;

export function WonCelebration({
  open,
  headline,
  subline,
  onDone,
}: {
  open: boolean;
  /** Overrides the image's own caption — e.g. "3 quotes sold". */
  headline?: string;
  subline?: string;
  onDone: () => void;
}) {
  // A showing is identified by a counter rather than by `open` itself, so the
  // image pick and the confetti scatter are re-rolled each time it opens and
  // stay put for the whole of that showing.
  const [showing, setShowing] = useState(0);
  const [image, setImage] = useState(IMAGES[0]);
  const [broken, setBroken] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setShowing((n) => n + 1);
      setImage(IMAGES[Math.floor(Math.random() * IMAGES.length)]);
      setBroken(false);
    }
    wasOpen.current = open;
  }, [open]);

  // Guards the caller's callback: the timer and the click can both land.
  const done = useRef(onDone);
  done.current = onDone;
  const spent = useRef(false);
  const finish = useCallback(() => {
    if (spent.current) return;
    spent.current = true;
    done.current();
  }, []);

  useEffect(() => {
    if (!open) return;
    spent.current = false;
    const t = setTimeout(finish, HOLD_MS);
    const onKey = () => finish();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, showing, finish]);

  // Scattered once per showing. Random in a `useMemo` is safe here because the
  // overlay only ever mounts from a click — it is never server-rendered.
  const confetti = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        key: `${showing}-${i}`,
        left: Math.random() * 100,
        delay: Math.random() * 700,
        duration: 1600 + Math.random() * 1200,
        drift: (Math.random() - 0.5) * 160,
        spin: (Math.random() - 0.5) * 900,
        size: 7 + Math.random() * 8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round: i % 3 === 0,
      })),
    [showing],
  );

  if (!open) return null;

  return (
    <div
      // Above modals: this can fire from a dialog, and it is the loudest thing
      // on screen while it's up. Never printed.
      className="no-print fixed inset-0 z-[60] flex cursor-pointer items-center justify-center overflow-hidden p-6"
      onClick={finish}
      role="status"
      aria-live="polite"
      aria-label={headline ?? image.alt}
    >
      <div aria-hidden className="won-scrim absolute inset-0 bg-brand-ink/55 backdrop-blur-[3px]" />

      <div aria-hidden className="pointer-events-none absolute inset-0">
        {confetti.map((c) => (
          <span
            key={c.key}
            className="won-confetti absolute top-0 block"
            style={{
              left: `${c.left}%`,
              width: c.size,
              height: c.round ? c.size : c.size * 1.6,
              backgroundColor: c.color,
              borderRadius: c.round ? '9999px' : '2px',
              animationDelay: `${c.delay}ms`,
              animationDuration: `${c.duration}ms`,
              // Read by the keyframes so every piece falls its own way.
              ['--won-drift' as string]: `${c.drift}px`,
              ['--won-spin' as string]: `${c.spin}deg`,
            }}
          />
        ))}
      </div>

      <div className="won-pop relative flex max-h-full w-full max-w-2xl flex-col items-center gap-5">
        {broken ? (
          // The images are dropped in by hand, so a missing file must never be
          // the thing that swallows the moment.
          <p className="won-wiggle rounded-2xl bg-white px-10 py-8 text-center font-display text-5xl font-extrabold tracking-tight text-brand-green shadow-modal">
            SOLD!
          </p>
        ) : (
          <img
            src={image.src}
            alt={image.alt}
            onError={() => setBroken(true)}
            className="won-wiggle max-h-[62vh] w-auto max-w-full rounded-2xl bg-white object-contain p-3 shadow-modal"
          />
        )}

        {headline && (
          <p className="text-center font-display text-2xl font-bold tracking-tight text-white drop-shadow sm:text-3xl">
            {headline}
          </p>
        )}
        <p className="text-center text-sm font-medium text-white/70">
          {subline ?? 'Click anywhere to keep going'}
        </p>
      </div>
    </div>
  );
}
