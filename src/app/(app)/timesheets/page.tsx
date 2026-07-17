import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { adminTimeByWeek } from '@/lib/data';
import { PageHeader, StatCard } from '@/components/ui';
import { TimesheetReview } from './TimesheetReview';

export const dynamic = 'force-dynamic';

export default async function TimesheetsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/dashboard');

  const weeks = await adminTimeByWeek(8);

  const totalHours = weeks.reduce((s, w) => s + w.total_hours, 0);
  const unpaidHours = weeks.reduce((s, w) => s + w.unpaid_hours, 0);
  const paidHours = Math.max(0, totalHours - unpaidHours);

  return (
    <div>
      <PageHeader
        title="Timesheets"
        subtitle="Review clocked hours by week and mark shifts as paid"
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Hours (8 weeks)" value={`${totalHours.toFixed(1)}h`} accent="gray" />
        <StatCard label="Paid" value={`${paidHours.toFixed(1)}h`} accent="green" />
        <StatCard label="Unpaid" value={`${unpaidHours.toFixed(1)}h`} accent="amber" />
      </div>

      <TimesheetReview weeks={weeks} />
    </div>
  );
}
