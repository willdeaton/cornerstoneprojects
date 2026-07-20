import { getCurrentUser } from '@/lib/auth';
import { listProjects, listUserTime, activeEntry, listActiveClockIns, weekNetHours } from '@/lib/data';
import { PageHeader } from '@/components/ui';
import { duration } from '@/lib/format';
import { TimeClock } from './TimeClock';
import { MyTimeList } from './MyTimeList';
import { TimeTabs } from '../TimeTabs';

export const dynamic = 'force-dynamic';

export default async function TimePage() {
  const user = (await getCurrentUser())!;
  const canManage = user.role === 'admin' || user.role === 'manager';
  const active = await activeEntry(user.id);
  const projects = (await listProjects()).filter((p) => p.status !== 'completed');
  const myEntries = await listUserTime(user.id, 25);
  const crew = await listActiveClockIns();
  const weekHours = await weekNetHours(user.id);

  return (
    <div>
      <PageHeader title="Time Clock" subtitle="Clock in and out to track your time" />
      <TimeTabs canManage={canManage} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TimeClock
            userName={user.name}
            active={
              active
                ? {
                    id: active.id,
                    projectName: active.project_name,
                    customer: active.customer,
                    clockIn: active.clock_in,
                    onBreak: active.on_break,
                    breakStart: active.break_start,
                  }
                : null
            }
            projects={projects.map((p) => ({ id: p.id, name: p.name, customer: p.customer }))}
            weekHours={weekHours}
          />

          <MyTimeList
            entries={myEntries.map((e) => ({
              id: e.id,
              project_id: e.project_id,
              project_name: e.project_name ?? null,
              customer: e.customer ?? null,
              clock_in: e.clock_in,
              clock_out: e.clock_out,
              note: e.note,
              paid: e.paid,
              break_minutes: Math.round(e.break_minutes ?? 0),
            }))}
            projects={projects.map((p) => ({ id: p.id, name: p.name, customer: p.customer }))}
          />
        </div>

        {/* Crew on the clock */}
        <div>
          <div className="card p-5">
            <h2 className="brand-heading mb-4 text-sm text-brand-gray">On the Clock Now</h2>
            {crew.length === 0 ? (
              <p className="py-3 text-center text-sm text-brand-gray">Nobody is clocked in.</p>
            ) : (
              <ul className="space-y-3">
                {crew.map((e) => (
                  <li key={e.id} className="flex items-center justify-between">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-brand-ink">
                        <span
                          className={`h-2 w-2 animate-pulse rounded-full ${
                            e.on_break ? 'bg-status-progress' : 'bg-brand-green'
                          }`}
                        />
                        {e.user_name}
                      </p>
                      <p className="pl-4 text-xs text-brand-gray">
                        {e.on_break ? 'On lunch break' : e.project_name ?? 'General (no job)'}
                      </p>
                    </div>
                    <span
                      className={`text-sm font-semibold ${
                        e.on_break ? 'text-amber-700' : 'text-brand-green-dark'
                      }`}
                    >
                      {duration(e.clock_in, null)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
