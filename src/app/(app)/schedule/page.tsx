import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listProjects, listActiveWorkers } from '@/lib/data';
import {
  listScheduleTasks,
  listCompletedJobTasks,
  listSubcontractors,
  listHolidays,
  listPublishedVersions,
  listCrewNotesForProjects,
  countScheduleChanges,
  listScheduleDrafts,
  listWarehouseDays,
  HISTORY_WEEKS,
} from '@/lib/schedule-data';
import { addDays, today, weekStart } from '@/lib/schedule-math';
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
 *
 * Finished jobs are loaded alongside the live ones, back as far as HISTORY_WEEKS,
 * so paging back to a previous week shows the work that actually ran that week
 * instead of a gap where a job has since been marked complete. They come in as
 * history: read-only in every view, and out of every count of work still to
 * plan or staff.
 */
export default async function SchedulePage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');

  // Back to the Monday that opens the oldest week worth keeping on screen, so
  // the history a manager can page into is the history that was loaded.
  const historyFrom = weekStart(addDays(today(), -7 * HISTORY_WEEKS));
  const [liveTasks, finishedTasks, holidays] = await Promise.all([
    listScheduleTasks(),
    listCompletedJobTasks(historyFrom),
    listHolidays(),
  ]);
  const tasks = [...liveTasks, ...finishedTasks];
  const holidayDays = holidays.map((h) => h.day);
  /** Jobs in `tasks` that are finished — history, and read-only wherever shown. */
  const finishedProjects = [...new Set(finishedTasks.map((t) => t.project_id))];

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

  const [projects, workers, subs, publications, changeCounts, draftJobs, warehouse, crewNotes] =
    await Promise.all([
      listProjects(),
      listActiveWorkers(),
      listSubcontractors({ activeOnly: true }),
      listPublishedVersions(),
      countScheduleChanges(),
      listScheduleDrafts(),
      listWarehouseDays(),
      // The crew-facing notes for every job with work on screen, so a job card
      // opened off the crew week reads the same instructions the crew will.
      listCrewNotesForProjects([...new Set(tasks.map((t) => t.project_id))]),
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
      >
        {/* The office display. Its own tab on purpose — it's a screen that gets
            left running on the wall, not a page you navigate away from. */}
        <a href="/tv" target="_blank" rel="noreferrer" className="btn-secondary">
          TV board
        </a>
      </PageHeader>
      <ScheduleViews
        tasks={tasks}
        warehouse={warehouse}
        // Live jobs, plus the finished ones whose work is in the history that
        // was loaded — a finished job's phases need its row to hang off.
        projects={projects
          .filter((p) => p.status !== 'completed' || finishedProjects.includes(p.id))
          .map((p) => ({
            id: p.id,
            name: p.name,
            customer: p.customer,
            status: p.status,
            site_address: p.site_address,
            due_date: p.due_date,
            hard_finish_date: p.hard_finish_date,
            // Parked waiting on somebody else: the board badges it rather than
            // hiding it, because a job standing still is exactly what a manager
            // reading the timeline is looking for.
            on_hold: p.on_hold,
            on_hold_reason: p.on_hold_reason,
            on_hold_since: p.on_hold_since,
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
        crewNotes={crewNotes}
        changeCounts={changes}
        canUnpublish={me.role === 'admin'}
        drafts={drafts}
        finishedProjects={finishedProjects}
      />
    </div>
  );
}
