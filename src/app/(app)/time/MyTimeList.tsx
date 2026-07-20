'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { dateTime, duration } from '@/lib/format';
import { TimeEntryModal, type ProjectOption, type TimeEntryInit } from '@/components/TimeEntryModal';

interface MyEntry {
  id: number;
  project_id: number | null;
  project_name: string | null;
  customer: string | null;
  clock_in: string;
  clock_out: string | null;
  note: string | null;
  paid: boolean;
  break_minutes: number;
}

export function MyTimeList({
  entries,
  projects,
}: {
  entries: MyEntry[];
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TimeEntryInit | null>(null);

  function refresh() {
    router.refresh();
  }

  return (
    <div className="card mt-6 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="brand-heading text-sm text-brand-gray">My Recent Time</h2>
        <button
          className="rounded-lg border border-brand-green/50 bg-brand-green/10 px-3 py-1.5 text-xs font-semibold text-brand-green-dark transition hover:bg-brand-green/20"
          onClick={() => setAdding(true)}
        >
          + Add past time
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="py-3 text-center text-sm text-brand-gray">No time logged yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-brand-gray">
                <th className="pb-2 font-semibold">Job</th>
                <th className="pb-2 font-semibold">Clocked In</th>
                <th className="pb-2 font-semibold">Clocked Out</th>
                <th className="pb-2 text-right font-semibold">Duration</th>
                <th className="pb-2 text-right font-semibold">Edit</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-black/5">
                  <td className="py-2.5">
                    <p className="font-medium text-brand-ink">{e.project_name ?? 'General (no job)'}</p>
                    {e.customer && <p className="text-xs text-brand-gray">{e.customer}</p>}
                  </td>
                  <td className="py-2.5 text-brand-gray">{dateTime(e.clock_in)}</td>
                  <td className="py-2.5 text-brand-gray">
                    {e.clock_out ? dateTime(e.clock_out) : <span className="text-brand-green-dark">Active</span>}
                  </td>
                  <td className="py-2.5 text-right font-semibold text-brand-ink">
                    {duration(e.clock_in, e.clock_out)}
                  </td>
                  <td className="py-2.5 text-right">
                    {e.clock_out ? (
                      e.paid ? (
                        <span className="text-xs text-brand-gray" title="Paid shifts can only be changed by a manager.">
                          Paid
                        </span>
                      ) : (
                        <button
                          className="text-xs font-semibold text-brand-green-dark hover:underline"
                          onClick={() =>
                            setEditing({
                              id: e.id,
                              projectId: e.project_id,
                              clockIn: e.clock_in,
                              clockOut: e.clock_out,
                              note: e.note,
                              breakMinutes: Math.round(e.break_minutes || 0),
                            })
                          }
                        >
                          Edit
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-brand-gray">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <TimeEntryModal
          open={adding}
          onClose={() => setAdding(false)}
          onSaved={refresh}
          projects={projects}
        />
      )}
      {editing && (
        <TimeEntryModal
          open={!!editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          projects={projects}
          entry={editing}
        />
      )}
    </div>
  );
}
