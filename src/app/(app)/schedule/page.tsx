import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listProjects, listActiveWorkers } from '@/lib/data';
import {
  listScheduleTasks,
  listSubcontractors,
  listHolidays,
  listPublishedVersions,
  countScheduleChanges,
} from '@/lib/schedule-data';
import { PageHeader } from '@/components/ui';
import { ScheduleViews } from './ScheduleViews';
import { MySchedule } from './MySchedule';
import type { PublishedInfo } from './PublishBar';

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

  const [projects, workers, subs, publications, changeCounts] = await Promise.all([
    listProjects(),
    listActiveWorkers(),
    listSubcontractors({ activeOnly: true }),
    listPublishedVersions(),
    countScheduleChanges(),
  ]);

  // Publish state per job: which version went out, and how many changes have
  // been explained since. Plain objects so it crosses to the client component.
  const published: Record<number, PublishedInfo> = {};
  for (const [projectId, pub] of publications) {
    published[projectId] = {
      version: pub.version,
      published_at: pub.published_at,
      published_by_name: pub.published_by_name ?? null,
      changeCount: changeCounts.get(projectId) ?? 0,
    };
  }

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle="Plan phases across your jobs, see who's working where each week, and send crews their dates"
      />
      <ScheduleViews
        tasks={tasks}
        projects={projects
          .filter((p) => p.status !== 'completed')
          .map((p) => ({ id: p.id, name: p.name, customer: p.customer, due_date: p.due_date }))}
        workers={workers.map((w) => ({ id: w.id, name: w.name, role: w.role }))}
        subs={subs.map((s) => ({ id: s.id, name: s.name, trade: s.trade }))}
        holidays={holidayDays}
        published={published}
        canUnpublish={me.role === 'admin'}
      />
    </div>
  );
}
