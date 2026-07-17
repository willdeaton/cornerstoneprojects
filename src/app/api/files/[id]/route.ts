import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getProjectFile } from '@/lib/data';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const file = await getProjectFile(Number(id));
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Stored as a data URL: data:<mime>;base64,<payload>
  const comma = file.data.indexOf(',');
  const base64 = comma >= 0 ? file.data.slice(comma + 1) : file.data;
  const bytes = Buffer.from(base64, 'base64');

  const download = new URL(_req.url).searchParams.get('download') === '1';
  const disposition = download ? 'attachment' : 'inline';
  const asciiName = (file.filename || 'file').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': file.mime || 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `${disposition}; filename="${asciiName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
