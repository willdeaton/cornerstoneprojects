'use client';

import { Fragment, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AdminWeek } from '@/lib/data';
import { shortDate, dateTime, duration, money } from '@/lib/format';
import { approveWeekAction, setEntryPaidAction, setWeekPaidAction } from '@/app/actions/time';
import { PrinterIcon } from '@/components/print';
import {
  TimeEntryModal,
  type ProjectOption,
  type UserOption,
  type TimeEntryInit,
} from '@/components/TimeEntryModal';

function weekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start.getTime() + 6 * 864e5);
  return `${shortDate(weekStart)} – ${shortDate(end.toISOString().slice(0, 10))}`;
}

export function TimesheetReview({
  weeks,
  projects,
  users,
  isAdmin,
}: {
  weeks: AdminWeek[];
  projects: ProjectOption[];
  users: UserOption[];
  isAdmin: boolean;
}) {
  const [pending, start] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addUserId, setAddUserId] = useState<number | undefined>(undefined);
  const [editing, setEditing] = useState<TimeEntryInit | null>(null);
  const [checkNums, setCheckNums] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function refresh() {
    router.refresh();
  }

  function key(weekStart: string, userId: number) {
    return `${weekStart}:${userId}`;
  }

  function toggleExpand(k: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }

  function markWeek(userId: number, weekStart: string, paid: boolean) {
    const k = key(weekStart, userId);
    const checkNumber = paid ? checkNums[k]?.trim() || null : null;
    setError(null);
    start(async () => {
      const res = await setWeekPaidAction(userId, weekStart, paid, checkNumber);
      if (!res.ok) {
        setError(res.error ?? 'Could not update paid status.');
        return;
      }
      setCheckNums((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
      router.refresh();
    });
  }

  function markEntry(entryId: number, paid: boolean) {
    setError(null);
    start(async () => {
      const res = await setEntryPaidAction(entryId, paid);
      if (!res.ok) {
        setError(res.error ?? 'Could not update paid status.');
        return;
      }
      router.refresh();
    });
  }

  function approve(userId: number, weekStart: string) {
    start(async () => {
      await approveWeekAction(userId, weekStart);
      router.refresh();
    });
  }

  function openAdd(userId?: number) {
    setAddUserId(userId);
    setAdding(true);
  }

  const modals = (
    <>
      {adding && (
        <TimeEntryModal
          open={adding}
          onClose={() => setAdding(false)}
          onSaved={refresh}
          projects={projects}
          users={users}
          defaultUserId={addUserId}
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
    </>
  );

  const addButton = (
    <button
      className="rounded-lg border border-brand-green/50 bg-brand-green/10 px-3 py-1.5 text-sm font-semibold text-brand-green-dark transition hover:bg-brand-green/20"
      onClick={() => openAdd(undefined)}
    >
      + Add time entry
    </button>
  );

  if (weeks.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">{addButton}</div>
        <div className="card flex flex-col items-center justify-center gap-1 p-10 text-center">
          <p className="font-semibold text-brand-ink">No time logged yet</p>
          <p className="text-sm text-brand-gray">
            Clocked-in shifts show up here grouped by week — or add one manually.
          </p>
        </div>
        {modals}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">{addButton}</div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {weeks.map((week) => (
        <div key={week.week_start} className="card overflow-hidden">
          {/* Week header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 bg-black/[0.02] px-5 py-4">
            <div>
              <h2 className="brand-heading text-base text-brand-ink">Week of {weekRange(week.week_start)}</h2>
              <p className="mt-0.5 text-xs text-brand-gray">
                {week.total_hours.toFixed(1)}h logged across {week.users.length}{' '}
                {week.users.length === 1 ? 'person' : 'people'}
              </p>
            </div>
            {week.fully_paid ? (
              <span className="badge bg-brand-green/20 text-brand-green-dark">All paid</span>
            ) : (
              <span className="badge bg-amber-100 text-amber-800">
                {week.unpaid_hours.toFixed(1)}h unpaid
              </span>
            )}
          </div>

          {/* Per-employee rows */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-brand-gray">
                  <th className="px-5 py-2.5 font-semibold">Employee</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Net Hours</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Check Amount</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Shifts</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Approval</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Paid</th>
                </tr>
              </thead>
              <tbody>
                {week.users.map((u) => {
                  const k = key(week.week_start, u.user_id);
                  const isOpen = expanded.has(k);
                  return (
                    <Fragment key={k}>
                      <tr className="border-b border-black/5">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <button
                              className="flex items-center gap-2 whitespace-nowrap font-semibold text-brand-ink hover:text-brand-green-dark"
                              onClick={() => toggleExpand(k)}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
                              >
                                <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              {u.user_name}
                            </button>
                            {/* This person's week as a sheet of paper — the
                                printable timesheet they sign, and the PDF
                                payroll gets. Icon only: the row is already
                                seven columns wide, and the same link is
                                spelled out in the shifts below. */}
                            <Link
                              href={`/timesheets/${u.user_id}/${week.week_start}/print`}
                              className="text-brand-gray transition hover:text-brand-green-dark"
                              title={`Print ${u.user_name}'s timesheet for this week`}
                              aria-label={`Print timesheet for ${u.user_name}`}
                            >
                              <PrinterIcon size={13} />
                            </Link>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-brand-ink">
                          {u.total_hours.toFixed(1)}h
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-brand-ink">
                          {u.hourly_rate != null ? (
                            money(u.total_hours * u.hourly_rate, { cents: true })
                          ) : (
                            <span className="font-normal text-brand-gray">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right text-brand-gray">{u.closed_count}</td>
                        <td className="px-3 py-3">
                          {u.closed_count === 0 ? (
                            <span className="text-xs text-brand-gray">In progress</span>
                          ) : u.all_paid ? (
                            <span className="text-xs font-medium text-brand-green-dark">
                              Paid{u.check_number ? ` · Check #${u.check_number}` : ''}
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-amber-700">
                              {u.unpaid_hours.toFixed(1)}h unpaid
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {u.approved_at ? (
                            <span className="badge bg-brand-green/20 text-brand-green-dark">
                              Approved
                              {u.approved_by_name ? ` by ${u.approved_by_name}` : ''}{' '}
                              {shortDate(u.approved_at)}
                            </span>
                          ) : (
                            <button
                              className="rounded-lg border border-brand-green/50 bg-brand-green/10 px-2.5 py-1 text-xs font-semibold text-brand-green-dark transition hover:bg-brand-green/20 disabled:opacity-50"
                              disabled={pending}
                              onClick={() => approve(u.user_id, week.week_start)}
                            >
                              Approve
                            </button>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {isAdmin ? (
                            <div className="flex items-center justify-end gap-2">
                              {!(u.closed_count > 0 && u.all_paid) && (
                                <input
                                  type="text"
                                  className="input h-8 w-24 px-2 py-1 text-xs"
                                  placeholder="Check #"
                                  aria-label={`Check number for ${u.user_name}`}
                                  value={checkNums[k] ?? ''}
                                  disabled={pending || u.closed_count === 0}
                                  onChange={(e) =>
                                    setCheckNums((prev) => ({ ...prev, [k]: e.target.value }))
                                  }
                                />
                              )}
                              <label className="inline-flex cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-[#98C73A]"
                                  checked={u.closed_count > 0 && u.all_paid}
                                  disabled={pending || u.closed_count === 0}
                                  onChange={(e) => markWeek(u.user_id, week.week_start, e.target.checked)}
                                />
                                <span className="text-xs text-brand-gray">Mark week</span>
                              </label>
                            </div>
                          ) : (
                            /* Managers see the read-only status (with check
                               number) in the Status column; marking paid is
                               admin-only. */
                            <span className="text-xs text-brand-gray">—</span>
                          )}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="border-b border-black/5 bg-black/[0.015]">
                          <td colSpan={6} className="px-5 py-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left uppercase tracking-wide text-brand-gray">
                                  <th className="py-1.5 font-semibold">Clock In</th>
                                  <th className="py-1.5 font-semibold">Clock Out</th>
                                  <th className="py-1.5 font-semibold">Job</th>
                                  <th className="py-1.5 text-right font-semibold">Break</th>
                                  <th className="py-1.5 text-right font-semibold">Net</th>
                                  <th className="py-1.5 text-right font-semibold">Paid</th>
                                  <th className="py-1.5 text-right font-semibold">Edit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {u.entries.map((en) => (
                                  <tr key={en.id} className="border-t border-black/5">
                                    <td className="py-2 text-brand-ink">{dateTime(en.clock_in)}</td>
                                    <td className="py-2 text-brand-gray">
                                      {en.clock_out ? (
                                        dateTime(en.clock_out)
                                      ) : (
                                        <span className="text-brand-green-dark">Active</span>
                                      )}
                                    </td>
                                    <td className="py-2 text-brand-gray">
                                      {en.project_name ?? 'General (no job)'}
                                      {en.note ? (
                                        <span className="block text-[11px] text-brand-gray/80">{en.note}</span>
                                      ) : null}
                                    </td>
                                    <td className="py-2 text-right text-brand-gray">
                                      {en.break_minutes > 0 ? `${en.break_minutes}m` : '—'}
                                    </td>
                                    <td className="py-2 text-right font-semibold text-brand-ink">
                                      {en.clock_out ? `${en.net_hours.toFixed(2)}h` : duration(en.clock_in, null)}
                                    </td>
                                    <td className="py-2 text-right">
                                      {isAdmin ? (
                                        <input
                                          type="checkbox"
                                          className="h-4 w-4 accent-[#98C73A]"
                                          checked={en.paid}
                                          disabled={pending || !en.clock_out}
                                          onChange={(e) => markEntry(en.id, e.target.checked)}
                                        />
                                      ) : en.paid ? (
                                        <span className="font-medium text-brand-green-dark">
                                          Paid{en.check_number ? ` · #${en.check_number}` : ''}
                                        </span>
                                      ) : (
                                        <span className="text-brand-gray">—</span>
                                      )}
                                    </td>
                                    <td className="py-2 text-right">
                                      {en.clock_out ? (
                                        <button
                                          className="font-semibold text-brand-green-dark hover:underline"
                                          onClick={() =>
                                            setEditing({
                                              id: en.id,
                                              projectId: en.project_id,
                                              clockIn: en.clock_in,
                                              clockOut: en.clock_out,
                                              note: en.note,
                                              breakMinutes: Math.round(en.break_minutes || 0),
                                            })
                                          }
                                        >
                                          Edit
                                        </button>
                                      ) : (
                                        <span className="text-brand-gray">—</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                                <tr>
                                  <td colSpan={7} className="pt-2">
                                    <div className="flex items-center gap-4">
                                      <button
                                        className="text-xs font-semibold text-brand-green-dark hover:underline"
                                        onClick={() => openAdd(u.user_id)}
                                      >
                                        + Add entry for {u.user_name}
                                      </button>
                                      <Link
                                        href={`/timesheets/${u.user_id}/${week.week_start}/print`}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-gray hover:text-brand-green-dark hover:underline"
                                      >
                                        <PrinterIcon size={13} />
                                        Print timesheet
                                      </Link>
                                    </div>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {modals}
    </div>
  );
}
