import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getInvoiceFile } from '@/lib/data';

export const runtime = 'nodejs';

/**
 * The PDF attached to one invoice.
 *
 * Gated to the billing roles rather than to "not an employee", which is the
 * line project files draw: an invoice is A/R paperwork, and the Billing tab is
 * a narrower audience than the Files tab on purpose.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const file = await getInvoiceFile(Number(id));
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Stored as a data URL: data:<mime>;base64,<payload>
  const comma = file.data.indexOf(',');
  const base64 = comma >= 0 ? file.data.slice(comma + 1) : file.data;
  const bytes = Buffer.from(base64, 'base64');

  const download = new URL(req.url).searchParams.get('download') === '1';
  const asciiName = (file.filename || 'invoice.pdf')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '');

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': file.mime || 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${asciiName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
