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
  listScheduleDrafts,
  listWarehouseDays,
} from '@/lib/schedule-data';
import { PageHeader } from '@/components/ui';
import { ScheduleViews } from './ScheduleViews';
import { MySchedule } from './MySchedule';
import type { PublishedInfo } from './PublishBar';

export const dynamic = 'force-dynamic';

/**
 * The schedule reads two ways: managers and admins get the editable timeline
 * and crew week across every live job, employees get a read-only week of their
 * own work they can step through a week at a time. Phase windows are derived, not
 * stored, so every view computes them from the same rows via schedule-math.
 */
export default async function SchedulePage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');

  const [tasks, holidays] = await Promise.all([listScheduleTasks(), listHolidays()]);
  const holidayDays = holidays.map((h) => h.day);

  if (me.role !== 'admin' && me.role !== 'manager') {
    // Their own warehouse days, so the week shows the days they're in there
    // alongside the days they're on a job.
    const myWarehouse = await listWarehouseDays({ userId: me.id });
    // Crew notes for the jobs they could be booked on, so the week view can show
    // the job-specific instructions alongside each day.
    const crewNotes = await listCrewNotesForProjects([
      ...new Set(
        tasks
          .filter((t) => t.crew_days.some((c) => c.kind === 'user' && c.ref_id === me.id))
          .map((t) => t.project_id)
      ),
    ]);
    return (
      <div>
        <PageHeader
          title="My Schedule"
          subtitle="The work you're booked on, one week at a time — where to be, and when to start"
        />
        <MySchedule
          tasks={tasks}
          warehouse={myWarehouse}
          holidays={holidayDays}
          userId={me.id}
          crewNotes={crewNotes}
        />
      </div>
    );
  }

  const [projects, workers, subs, publications, changeCounts, draftJobs, warehouse] =
    await Promise.all([
      listProjects(),
      listActiveWorkers(),
      listSubcontractors({ activeOnly: true }),
      listPublishedVersions(),
      countScheduleChanges(),
      listScheduleDrafts(),
      listWarehouseDays(),
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

  // Jobs whose dates have moved since the crew was last told, with the version
  // they still have — what the Publish button offers to send.
  const drafts = draftJobs.map((d) => ({
    project_id: d.project_id,
    project_name: d.project_name,
    customer: d.customer,
    changed_at: d.changed_at,
    changed_by_name: d.changed_by_name ?? null,
    version: publications.get(d.project_id)?.version ?? null,
  }));

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle="Plan and save the work as a draft, then publish it to send every crew their own dates"
      />
      <ScheduleViews
        tasks={tasks}
        warehouse={warehouse}
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
        // Everybody active, with whether they're in scheduling at all: the crew
        // week hides the ones who aren't, but still shows anybody already booked
        // so a schedule that has gone out can't quietly lose a name.
        workers={workers.map((w) => ({
          id: w.id,
          name: w.name,
          role: w.role,
          schedulable: w.schedulable,
        }))}
        subs={subs.map((s) => ({ id: s.id, name: s.name, trade: s.trade }))}
        holidays={holidayDays}
        published={published}
        changeCounts={changes}
        canUnpublish={me.role === 'admin'}
        drafts={drafts}
      />
    </div>
  );
}
