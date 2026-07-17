import { getCurrentUser } from '@/lib/auth';
import { listProjects, listUserTime, activeEntry, listActiveClockIns, weekNetHours } from '@/lib/data';
import { PageHeader } from '@/components/ui';
import { dateTime, duration } from '@/lib/format';
import { TimeClock } from './TimeClock';

export const dynamic = 'force-dynamic';

export default async function TimePage() {
  const user = (await getCurrentUser())!;
  const active = await activeEntry(user.id);
  const projects = (await listProjects()).filter((p) => p.status !== 'completed');
  const myEntries = await listUserTime(user.id, 25);
  const crew = await listActiveClockIns();
  const weekHours = await weekNetHours(user.id);

  return (
    <div>
      <PageHeader title="Time Clock" subtitle="Clock in and out to track your time" />

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

          <div className="card mt-6 p-5">
            <h2 className="brand-heading mb-4 text-sm text-brand-gray">My Recent Time</h2>
            {myEntries.length === 0 ? (
              <p className="py-3 text-center text-sm text-brand-gray">No time logged yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-brand-gray">
                      <th className="pb-2 font-semibold">Job</th>
                      <th className="pb-2 font-semibold">Clocked In</th>
                      <th className="pb-2 font-semibold">Clocked Out</th>
                      <th className="pb-2 text-right font-semibold">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myEntries.map((e) => (
                      <tr key={e.id} className="border-t border-black/5">
                        <td className="py-2.5">
                          <p className="font-medium text-brand-ink">
                            {e.project_name ?? 'General (no job)'}
                          </p>
                          {e.customer && <p className="text-xs text-brand-gray">{e.customer}</p>}
                        </td>
                        <td className="py-2.5 text-brand-gray">{dateTime(e.clock_in)}</td>
                        <td className="py-2.5 text-brand-gray">
                          {e.clock_out ? dateTime(e.clock_out) : <span className="text-brand-green-dark">Active</span>}
                        </td>
                        <td className="py-2.5 text-right font-semibold text-brand-ink">
                          {duration(e.clock_in, e.clock_out)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
