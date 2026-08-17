import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listProjects, listActiveWorkers } from '@/lib/data';
import { listScheduleTasks, listSubcontractors, listHolidays } from '@/lib/schedule-data';
import { PageHeader } from '@/components/ui';
import { ScheduleBoard } from './ScheduleBoard';
import { MySchedule } from './MySchedule';

export const dynamic = 'force-dynamic';

/**
 * The schedule reads two ways: managers and admins get the editable timeline
 * across every live job, workers get a read-only list of their own next two
 * weeks. Phase windows are derived, not stored, so both views compute them from
 * the same rows via schedule-math.
 */
export default async function SchedulePage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');

  const [tasks, holidays] = await Promise.all([listScheduleTasks(), listHolidays()]);
  const holidayDays = holidays.map((h) => h.day);

  if (me.role !== 'admin' && me.role !== 'manager') {
    return (
      <div>
        <PageHeader title="My Schedule" subtitle="The work you're booked on over the next two weeks" />
        <MySchedule tasks={tasks} holidays={holidayDays} userId={me.id} />
      </div>
    );
  }

  const [projects, workers, subs] = await Promise.all([
    listProjects(),
    listActiveWorkers(),
    listSubcontractors({ activeOnly: true }),
  ]);

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle="Plan phases across your jobs, see where work overlaps, and send crews their dates"
      />
      <ScheduleBoard
        tasks={tasks}
        projects={projects
          .filter((p) => p.status !== 'completed')
          .map((p) => ({ id: p.id, name: p.name, customer: p.customer, due_date: p.due_date }))}
        workers={workers.map((w) => ({ id: w.id, name: w.name, role: w.role }))}
        subs={subs.map((s) => ({ id: s.id, name: s.name, trade: s.trade }))}
        holidays={holidayDays}
      />
    </div>
  );
}
