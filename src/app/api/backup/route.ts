import { getCurrentUser } from '@/lib/auth';
import { getBackupData } from '@/lib/data';
import { getCompanyInfo } from '@/lib/company';
import type { BackupPayload } from '@/lib/backup-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns every quote / project / time record in the requested date range (plus
 * customers and the pricing catalog) as JSON. The Backup panel turns this into
 * a workbook + quote PDFs and zips it client-side. Admin/manager only, matching
 * the rest of the Settings section.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (user.role !== 'admin' && user.role !== 'manager') {
    return new Response('Forbidden', { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return Response.json({ error: 'Provide a start and end date (YYYY-MM-DD).' }, { status: 400 });
  }
  if (from > to) {
    return Response.json({ error: 'The start date must be on or before the end date.' }, { status: 400 });
  }

  const [data, company] = await Promise.all([getBackupData(from, to), getCompanyInfo()]);

  const payload: BackupPayload = {
    ...data,
    company,
    range: { from, to },
    generatedAt: new Date().toISOString(),
  };
  return Response.json(payload);
}
