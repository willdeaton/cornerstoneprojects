import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listProjects, listActiveWorkers } from '@/lib/data';
import {
  listScheduleTasks,
  listSubcontractors,
  listHolidays,
  listPublishedVersions,
  listCrewNotesForProjects,
  countScheduleChanges,
} from '@/lib/schedule-data';
import { PageHeader } from '@/components/ui';
import { ScheduleViews } from './ScheduleViews';
import { MySchedule } from './MySchedule';
import type { PublishedInfo } from './PublishBar';

export const dynamic = 'force-dynamic';

/**
 * The schedule reads two ways: managers and admins get the editable timeline
 * across every live job, workers get a read-only week of their own work they can
 * step through a week at a time. Phase windows are derived, not stored, so both
 * views compute them from the same rows via schedule-math.
 */
export default async function SchedulePage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');

  const [tasks, holidays] = await Promise.all([listScheduleTasks(), listHolidays()]);
  const holidayDays = holidays.map((h) => h.day);

  if (me.role !== 'admin' && me.role !== 'manager') {
    // Crew notes for the jobs they could be booked on, so the week view can show
    // the job-specific instructions alongside each day.
    const crewNotes = await listCrewNotesForProjects([
      ...new Set(tasks.filter((t) => t.assignees.some((a) => a.kind === 'user' && a.ref_id === me.id)).map((t) => t.project_id)),
    ]);
    return (
      <div>
        <PageHeader
          title="My Schedule"
          subtitle="The work you're booked on, one week at a time — where to be, and when to start"
        />
        <MySchedule
          tasks={tasks}
          holidays={holidayDays}
          userId={me.id}
          crewNotes={crewNotes}
        />
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
  // Reasons are logged whether or not a job has been published, so the counts
  // travel separately too — an unplanned job can already have a history.
  const changes: Record<number, number> = {};
  for (const [projectId, n] of changeCounts) changes[projectId] = n;

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle="Every live job in one timeline — plan phases, set crew start times, and send crews their dates"
      />
      <ScheduleViews
        tasks={tasks}
        projects={projects
          .filter((p) => p.status !== 'completed')
          .map((p) => ({
            id: p.id,
            name: p.name,
            customer: p.customer,
            status: p.status,
            site_address: p.site_address,
            due_date: p.due_date,
            hard_finish_date: p.hard_finish_date,
          }))}
        workers={workers.map((w) => ({ id: w.id, name: w.name, role: w.role }))}
        subs={subs.map((s) => ({ id: s.id, name: s.name, trade: s.trade }))}
        holidays={holidayDays}
        published={published}
        changeCounts={changes}
        canUnpublish={me.role === 'admin'}
      />
    </div>
  );
}
