import { getCurrentUser } from '@/lib/auth';
import { listProjects, listUserTime, activeEntry, listActiveClockIns } from '@/lib/data';
import { PageHeader } from '@/components/ui';
import { dateTime, duration } from '@/lib/format';
import { TimeClock } from './TimeClock';

export const dynamic = 'force-dynamic';

export default async function TimePage() {
  const user = (await getCurrentUser())!;
  const active = activeEntry(user.id);
  const projects = listProjects().filter((p) => p.status !== 'completed');
  const myEntries = listUserTime(user.id, 25);
  const crew = listActiveClockIns();

  // Total hours this week for the current user
  const weekAgo = Date.now() - 7 * 864e5;
  const weekHours = myEntries
    .filter((e) => e.clock_out)
    .filter((e) => new Date(e.clock_in.replace(' ', 'T') + 'Z').getTime() > weekAgo)
    .reduce((s, e) => {
      const start = new Date(e.clock_in.replace(' ', 'T') + 'Z').getTime();
      const end = new Date(e.clock_out!.replace(' ', 'T') + 'Z').getTime();
      return s + Math.max(0, (end - start) / 3600000);
    }, 0);

  return (
    <div>
      <PageHeader title="Time Clock" subtitle="Clock in and out of jobs to track time" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TimeClock
            userName={user.name}
            active={
              active
                ? { id: active.id, projectName: active.project_name, customer: active.customer, clockIn: active.clock_in }
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
                          <p className="font-medium text-brand-ink">{e.project_name}</p>
                          <p className="text-xs text-brand-gray">{e.customer}</p>
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
                        <span className="h-2 w-2 animate-pulse rounded-full bg-brand-green" />
                        {e.user_name}
                      </p>
                      <p className="pl-4 text-xs text-brand-gray">{e.project_name}</p>
                    </div>
                    <span className="text-sm font-semibold text-brand-green-dark">
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
