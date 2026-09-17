import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listActiveWorkers, listProjects } from '@/lib/data';
import { getBranding } from '@/lib/branding-store';
import {
  listCompletedJobTasks,
  listHolidays,
  listScheduleTasks,
  listWarehouseDays,
} from '@/lib/schedule-data';
import { addDays, today, weekStart } from '@/lib/schedule-math';
import { TvBoard } from './TvBoard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Schedule Status Board',
  description: 'The day and the weeks ahead, for a screen on the office wall.',
};

/** Seconds each screen is up before the board turns over. */
const DEFAULT_ROTATE = 25;
/** Weeks of timeline on screen at once. */
const DEFAULT_WEEKS = 3;

/**
 * The office status board — the Schedule, for a TV nobody touches.
 *
 * Deliberately outside the `(app)` group: the app shell's sidebar, the "view
 * as" switcher and the backup reminder are all things you click, and none of
 * them belong on a screen on the wall. What's left is the schedule itself,
 * full-bleed and dark, rotating between today's jobs, where everybody is this
 * fortnight, and the weeks ahead.
 *
 * It is still a signed-in page — the whole company's jobs, customers and crew
 * are on it — so the TV signs in once, as a manager or admin, and stays signed
 * in (sessions last 30 days). An employee who lands here goes to their own
 * schedule instead, which is the same line the rest of the app draws.
 *
 * The URL takes the settings a wall screen actually needs:
 *   /tv                          all three screens, rotating
 *   /tv?panel=today              today only
 *   /tv?panel=crew               the crew week only
 *   /tv?panel=timeline           the timeline only
 *   /tv?rotate=40&weeks=6        a slower turnover and a longer view
 */
export default async function TvPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; rotate?: string; weeks?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/schedule');

  const params = await searchParams;
  const panel =
    params.panel === 'today' || params.panel === 'crew' || params.panel === 'timeline'
      ? params.panel
      : 'rotate';
  const rotateSeconds = clamp(Number(params.rotate), 5, 300, DEFAULT_ROTATE);
  const weeks = clamp(Number(params.weeks), 1, 8, DEFAULT_WEEKS);

  // The board opens on the Monday of the current week and never pages back, so
  // that Monday is the earliest day anything on screen can be drawn on.
  const from = weekStart(today());
  const [liveTasks, finishedTasks, holidays, warehouse, workers, projects, branding] =
    await Promise.all([
      listScheduleTasks(),
      // The same history the Schedule loads, clipped to the weeks this board
      // actually shows. Without it a job finished on Tuesday takes Monday's
      // crew off the board with it, and the fortnight up here stops matching
      // the fortnight on the Schedule — which is the one thing a second view of
      // the same data must never do.
      listCompletedJobTasks(from),
      listHolidays(),
      // A fortnight past the timeline's own window, so the "next up" rail still
      // has warehouse days to read when the board is left on over a weekend.
      listWarehouseDays({ from, to: addDays(from, weeks * 7 + 14) }),
      listActiveWorkers(),
      listProjects(),
      getBranding(),
    ]);

  const tasks = [...liveTasks, ...finishedTasks];
  /** Jobs on the board that are over: history, and never work still to staff. */
  const finishedProjects = [...new Set(finishedTasks.map((t) => t.project_id))];

  return (
    <TvBoard
      tasks={tasks}
      warehouse={warehouse}
      workers={workers.map((w) => ({ id: w.id, name: w.name, schedulable: w.schedulable }))}
      // Live jobs, plus the finished ones whose work ran inside the weeks on
      // screen — a finished job's phases need its row to hang off.
      projects={projects
        .filter((p) => p.status !== 'completed' || finishedProjects.includes(p.id))
        .map((p) => ({ id: p.id, name: p.name, customer: p.customer, status: p.status }))}
      finishedProjects={finishedProjects}
      holidays={holidays.map((h) => h.day)}
      logoSrc={branding.full}
      serverDay={today()}
      loadedAt={new Date().toISOString()}
      panel={panel}
      rotateSeconds={rotateSeconds}
      weeks={weeks}
    />
  );
}

/** A URL number, kept inside what the board can actually draw. */
function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
