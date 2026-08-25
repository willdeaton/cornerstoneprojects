import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getReceiptImage } from '@/lib/data';

export const runtime = 'nodejs';

/**
 * The photo attached to one receipt.
 *
 * Gated to the billing roles rather than to "not an employee", which is the
 * line project files draw: what a job cost is billing information, and the
 * Receipts tab has the same narrower audience the Billing tab does.
 *
 * `?size=thumb` serves the small browser-made copy instead of the original.
 * The table asks for that one — thirty full photos through a no-store route to
 * draw thumbnails 40px wide is megabytes nobody needs.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const img = await getReceiptImage(Number(id));
  // Also the answer for a receipt that exists but has no photo on it.
  if (!img) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const wantThumb = url.searchParams.get('size') === 'thumb' && !!img.thumb;
  const source = wantThumb ? img.thumb! : img.data;
  // The thumbnail is always the JPEG the browser encoded, whatever the original was.
  const mime = wantThumb ? 'image/jpeg' : img.mime || 'application/octet-stream';

  // Stored as a data URL: data:<mime>;base64,<payload>
  const comma = source.indexOf(',');
  const base64 = comma >= 0 ? source.slice(comma + 1) : source;
  const bytes = Buffer.from(base64, 'base64');

  const download = url.searchParams.get('download') === '1';
  const asciiName = (img.filename || 'receipt').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${asciiName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
