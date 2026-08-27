import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { employeeWeekTimesheet } from '@/lib/data';
import { getCompanyInfo } from '@/lib/company';
import { PrintToolbar } from './PrintToolbar';
import { TimesheetDocument } from './TimesheetDocument';

export const dynamic = 'force-dynamic';

/**
 * One employee's weekly timesheet as a printable document, reached from the
 * Print link on their row of the Timesheets review table. Outside the app
 * shell, like the quote document, so what's on screen is the sheet itself.
 *
 * `weekStart` is any date inside the wanted week — the data layer normalizes it
 * to that week's Monday, so a link can pass the review table's week key
 * straight through.
 */
export default async function TimesheetPrintPage({
  params,
}: {
  params: Promise<{ userId: string; weekStart: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  // Same gate as /timesheets: the sheet carries pay rates and check numbers.
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/time');

  const { userId, weekStart } = await params;
  const numId = Number(userId);
  if (!Number.isFinite(numId)) notFound();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) notFound();

  const sheet = await employeeWeekTimesheet(numId, weekStart);
  if (!sheet) notFound();

  const company = await getCompanyInfo();

  // e.g. Timesheet-Dana-Reyes-2026-08-24
  const pdfFileName = `Timesheet-${sheet.user_name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${sheet.week_start}`;

  return (
    <div className="min-h-screen bg-neutral-100">
      <PrintToolbar backHref="/timesheets" fileName={pdfFileName} />
      <TimesheetDocument sheet={sheet} company={company} />
    </div>
  );
}
