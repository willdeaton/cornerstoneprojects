'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/Modal';
import { dateTime, money, shortDate } from '@/lib/format';
import {
  DAY_LABELS,
  addDays,
  crewBudget,
  crewByDay,
  crewRoster,
  eachDay,
  fromDay,
  isWorkingDay,
  mondayLabel,
  shiftLabel,
  weekStart,
  type ComputedWindow,
  type DayShift,
} from '@/lib/schedule-math';
import { diffTask, needsReason, summarizeChanges } from '@/lib/schedule-diff';
import { TASK_STATUS_LABELS, type CrewNote, type ScheduleTaskRow, type TaskDayTime } from '@/lib/types';
import type { ScheduleDraft } from './useScheduleDraft';

/** The person and day a card was opened from — a booking on the crew grid. */
export interface CardFocus {
  /** The day whose chip was clicked, highlighted through the card. */
  day: string;
  kind: 'user' | 'sub';
  refId: number;
  name: string;
}

/**
 * One job's card, opened from the crew week.
 *
 * This is the crew-facing half of a phase: what the job is, when they start,
 * how long they're there, which days they're on and what they need to know
 * before they turn up. All of it belongs here rather than on the timeline
 * because none of it makes sense without the days in front of you — a 6 AM
 * delivery is a fact about a Tuesday, not about a bar on a Gantt chart.
 *
 * It opens from a booking on the grid as well as from a card's ⋯, so clicking
 * somebody's Wednesday answers "what is this, and what time do I start" in one
 * step. Opened that way it knows whose day it was: their name and that day are
 * called out, and the days they're on are marked through the week.
 *
 * A job is booked for the WHOLE DAY unless somebody puts hours on it. Hours are
 * how a day gets shared: 8:00 for 4 hours here and noon for 4 hours there is
 * one person at two sites in a day, and the crew week stops calling that a
 * double-booking once both shifts are bounded.
 *
 * Who is booked shows here too, day by day, so a card is one place to read
 * "this is the job, this is the crew, this is when they start". On a
 * subcontracted phase the sub isn't listed per day and can't be taken off one:
 * they hold the whole phase, so their days follow its dates and change on the
 * timeline.
 *
 * A phase on a finished job opens read-only. Its times and notes are the record
 * of a week that has been worked, so they're here to read and nothing here
 * writes to the draft.
 */
export function CrewJobCard({
  task,
  window,
  holidays,
  publishedVersion,
  draft,
  crewNotes = [],
  focus = null,
  readOnly = false,
  onClose,
  onSaved,
}: {
  task: ScheduleTaskRow;
  /** The phase's computed window — the days a time can be set on. */
  window: ComputedWindow | undefined;
  holidays: string[];
  /** The job's published version, when its schedule has gone out. */
  publishedVersion?: number | null;
  /** The draft the card's changes join — saved with everything else. */
  draft: ScheduleDraft;
  /** The job's notes for whoever works it — written on the job, read here. */
  crewNotes?: CrewNote[];
  /** The booking the card was opened from, when it was opened from one. */
  focus?: CardFocus | null;
  /** The job is finished: everything here is a record, nothing is editable. */
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [startTime, setStartTime] = useState(task.start_time ?? '');
  // Blank is all day — the default a job books for. Kept as the typed string so
  // a half-finished "4." doesn't get rewritten under the cursor.
  const [hours, setHours] = useState(task.hours != null ? String(task.hours) : '');
  // Presence in the map is an override for that day; an entry with no start
  // time is an override that says "no set time on this day", and one with no
  // hours is that day worked all day.
  const [dayTimes, setDayTimes] = useState<Map<string, DayShift>>(
    () =>
      new Map(
        (task.day_times ?? []).map((d) => [
          d.day,
          { startTime: d.start_time, hours: d.hours ?? null },
        ])
      )
  );
  const [notes, setNotes] = useState(task.notes ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);

  // The days of the phase a time can be set on: every working day of its
  // window, plus any weekend or holiday somebody has actually been booked on —
  // a Saturday being worked needs a start time as much as a Tuesday does.
  const workingDays = useMemo(() => {
    if (!window) return [];
    const worked = new Set((task.crew_days ?? []).map((c) => c.day));
    return eachDay(window.start, window.end).filter(
      (d) => isWorkingDay(d, calendar) || worked.has(d)
    );
  }, [window, calendar, task]);

  const budget = crewBudget(task, window, calendar);
  const byDay = useMemo(() => crewByDay(task), [task]);
  const roster = useMemo(() => crewRoster(task), [task]);

  /**
   * The days the person whose booking was clicked is on this phase. A sub who
   * holds the phase has no booked days at all — they're on site because they
   * have the work — so their days are the phase's own.
   */
  const focusDays = useMemo(() => {
    if (!focus) return new Set<string>();
    const own = (task.crew_days ?? [])
      .filter((c) => c.kind === focus.kind && c.ref_id === focus.refId)
      .map((c) => c.day);
    if (own.length > 0) return new Set(own);
    if (focus.kind === 'sub' && task.subcontractor_id === focus.refId && window) {
      return new Set(
        eachDay(window.start, window.end).filter((d) => isWorkingDay(d, calendar))
      );
    }
    return new Set(own);
  }, [task, focus, window, calendar]);

  /** True when the card was opened from the sub who carries the whole phase. */
  const focusIsSub =
    focus != null && focus.kind === 'sub' && task.subcontractor_id === focus.refId;

  /**
   * The phase's whole block of days, week by week — Monday to Sunday, with the
   * days it actually runs filled in.
   *
   * The same shape the days row on a job's own paperwork takes: a week at a
   * time, so "which days are they there" is read rather than worked out from
   * two dates. Read-only on purpose — a phase's dates move on the timeline,
   * where the work that follows it moves with them.
   */
  const dayBlock = useMemo(() => {
    if (!window) return [];
    const worked = new Set((task.crew_days ?? []).map((c) => c.day));
    const days = eachDay(weekStart(window.start), addDays(weekStart(window.end), 6));
    const out: { monday: string; days: { day: string; inPhase: boolean; off: boolean }[] }[] = [];
    for (const day of days) {
      const monday = weekStart(day);
      const open = out[out.length - 1];
      const cell = {
        day,
        inPhase:
          day >= window.start &&
          day <= window.end &&
          (isWorkingDay(day, calendar) || worked.has(day)),
        off: !isWorkingDay(day, calendar),
      };
      if (open && open.monday === monday) open.days.push(cell);
      else out.push({ monday, days: [cell] });
    }
    return out;
  }, [window, task, calendar]);

  const draftStartTime = startTime.trim() === '' ? null : startTime.trim();
  const draftHours = parseHours(hours);
  const draftShift: DayShift = { startTime: draftStartTime, hours: draftHours };

  /**
   * The overrides worth saving: days still inside the phase's window. A phase
   * that shrinks or moves drops the times for days it no longer covers, so a
   * stale 6 AM never lingers on a day nobody works.
   */
  const draftDayTimes = useMemo<TaskDayTime[]>(() => {
    const inWindow = new Set(workingDays);
    return [...dayTimes.entries()]
      .filter(([day]) => inWindow.has(day))
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, shift]) => ({ day, start_time: shift.startTime, hours: shift.hours }));
  }, [dayTimes, workingDays]);

  // The same wording the server will log, so nothing is a surprise after saving.
  const changes = useMemo(() => {
    const base = {
      name: task.name,
      start_date: task.start_date,
      duration_days: task.duration_days,
      depends_on_id: task.depends_on_id,
      depends_type: task.depends_type ?? 'finish_to_start',
      lag_days: task.lag_days,
      crew_size: task.crew_size,
      subcontractor_id: task.subcontractor_id,
      status: task.status,
    };
    return diffTask(
      {
        ...base,
        start_time: task.start_time ?? null,
        hours: task.hours ?? null,
        day_times: task.day_times ?? [],
        notes: task.notes,
      },
      {
        ...base,
        start_time: draftStartTime,
        hours: draftHours,
        day_times: draftDayTimes,
        notes: notes.trim() === '' ? null : notes.trim(),
      },
      { phase: () => task.name, sub: () => task.subcontractor_name ?? 'a subcontractor' }
    );
  }, [task, draftStartTime, draftHours, draftDayTimes, notes]);

  const reasonRequired = needsReason(changes, publishedVersion != null);

  /** Patch one day's shift, starting from whatever it inherits today. */
  function setDayShift(day: string, patch: Partial<DayShift>) {
    setDayTimes((prev) => {
      const current = prev.get(day) ?? { startTime: draftStartTime, hours: draftHours };
      return new Map(prev).set(day, { ...current, ...patch });
    });
  }

  /** Give one day its own start time; an empty value means "no time that day". */
  function setDayTime(day: string, value: string) {
    setDayShift(day, { startTime: value.trim() === '' ? null : value.trim() });
  }

  /** Give one day its own length; blank goes back to all day for that day. */
  function setDayHours(day: string, value: string) {
    setDayShift(day, { hours: parseHours(value) });
  }

  /** Drop a day's override so it follows the phase's daily shift again. */
  function clearDayTime(day: string) {
    setDayTimes((prev) => {
      const next = new Map(prev);
      next.delete(day);
      return next;
    });
  }

  function unassign(day: string, kind: 'user' | 'sub', refId: number) {
    const person = (task.crew_days ?? []).find(
      (c) => c.day === day && c.kind === kind && c.ref_id === refId
    );
    setRemoving(`${day}:${kind}:${refId}`);
    draft.queue({
      kind: 'crew-unbook',
      projectId: task.project_id,
      taskId: task.id,
      label: `${person?.name ?? 'Crew'} off ${task.name} (${task.project_name})`,
      person: { kind, ref_id: refId, name: person?.name ?? 'Crew', detail: person?.detail ?? null },
      days: [day],
    });
    setRemoving(null);
    onSaved();
  }

  /**
   * Put the card's changes into the draft. Times and crew notes are what the
   * crew reads before they turn up, so they only reach them when the schedule
   * is published — saving the draft just keeps the work.
   */
  function submit() {
    setError(null);
    setSaving(true);
    draft.queue({
      kind: 'crew-card',
      projectId: task.project_id,
      taskId: task.id,
      label: `${task.name} shift and notes (${task.project_name})`,
      start_time: draftStartTime,
      hours: draftHours,
      day_times: draftDayTimes,
      notes: notes.trim() === '' ? null : notes.trim(),
      reason: reason.trim() === '' ? null : reason.trim(),
    });
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={`${task.name} — ${task.project_name}`} wide>
      <div className="space-y-4">
        {/* Whose day this is. Opened from a booking, the card leads with the
            person and the day clicked — that's the question being asked. */}
        {focus && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-brand-green/40 bg-brand-green/10 px-3 py-2 text-sm">
            <span className="font-semibold text-brand-ink">{focus.name}</span>
            <span className="text-brand-ink">
              {fromDay(focus.day).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span className="text-brand-gray">
              · {shiftLabel(dayTimes.get(focus.day) ?? draftShift)}
            </span>
            <span className="text-brand-gray">
              ·{' '}
              {focusIsSub
                ? `subcontracted — on site all ${focusDays.size} working ${
                    focusDays.size === 1 ? 'day' : 'days'
                  }`
                : `${focusDays.size} ${focusDays.size === 1 ? 'day' : 'days'} on this phase`}
            </span>
          </div>
        )}

        {/* The job itself, in the shape the paperwork has it: what was sold,
            where it is, what it's worth, and how much crew it carries. */}
        <div className="rounded-lg border border-black/10 bg-black/[.02] px-4 py-3">
          <p className="text-sm font-semibold text-brand-ink">
            {window ? `${shortDate(window.start)} → ${shortDate(window.end)}` : 'No dates yet'}
            <span className="ml-2 font-normal text-brand-gray">
              {budget.days} working {budget.days === 1 ? 'day' : 'days'} ·{' '}
              {TASK_STATUS_LABELS[task.status]}
            </span>
          </p>
          <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <Detail label="Customer" value={task.customer} />
            <Detail label="Proposal #" value={task.quote_number} />
            <Detail label="Service" value={task.project_category} />
            <Detail label="Job" value={task.project_name} />
            <Detail label="Phase" value={task.name} />
            <Detail label="Location" value={task.location} />
            <Detail
              label="Total Cost"
              value={task.project_value > 0 ? money(task.project_value) : null}
            />
            <Detail
              label="Shifts"
              value={
                budget.capacity > 0
                  ? `${budget.filled} / ${budget.capacity} crew ${
                      budget.capacity === 1 ? 'day' : 'days'
                    } · ${budget.needed} a day`
                  : task.subcontractor_name
                    ? 'Subcontracted — none of ours'
                    : 'Nobody planned'
              }
            />
            {task.subcontractor_name && (
              <Detail label="Subcontractor" value={task.subcontractor_name} />
            )}
            {task.site_address && (
              <div className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray">
                  Site Address
                </dt>
                <dd className="text-sm">
                  <a
                    href={mapsUrl(task.site_address)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-green-dark hover:underline"
                  >
                    {task.site_address}
                  </a>
                </dd>
              </div>
            )}
          </dl>
          {roster.length > 0 && (
            <p className="mt-2 text-sm text-brand-ink">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray">
                On this phase:{' '}
              </span>
              {roster
                .map((r) => `${r.name} (${r.days}${r.days === 1 ? ' day' : ' days'})`)
                .join(', ')}
            </p>
          )}
          <Link
            href={`/projects/${task.project_id}`}
            className="mt-1 inline-block text-xs font-medium text-brand-green-dark hover:underline"
          >
            Open the job →
          </Link>
        </div>

        {/* The days the phase runs, a week at a time. The days somebody is
            actually booked on carry their mark, so the week reads as "these are
            the days" rather than a pair of dates to work out. */}
        {dayBlock.length > 0 && (
          <div className="rounded-lg border border-black/10 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                Days Worked {focus ? `· ${focus.name}'s days ringed` : ''}
              </p>
              <p className="text-[11px] text-brand-gray">
                Dates move on the Job Timeline, where the work after them moves too
              </p>
            </div>
            <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
              {dayBlock.map((week) => (
                <div key={week.monday}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray/80">
                    Week of {mondayLabel(week.monday)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {week.days.map((cell) => {
                      const mine = focusDays.has(cell.day);
                      const crew = byDay.get(cell.day)?.length ?? 0;
                      return (
                        <div
                          key={cell.day}
                          title={`${fromDay(cell.day).toLocaleDateString('en-US', {
                            weekday: 'long',
                            month: 'short',
                            day: 'numeric',
                          })}\n${
                            cell.inPhase
                              ? `${shiftLabel(dayTimes.get(cell.day) ?? draftShift)} · ${crew} booked`
                              : 'Not a day of this phase'
                          }`}
                          className={`w-[52px] rounded-md border px-1 py-1 text-center leading-tight ${
                            cell.inPhase
                              ? cell.off
                                ? 'border-amber-300 bg-amber-100 text-amber-900'
                                : 'border-brand-green bg-brand-green/20 text-brand-ink'
                              : 'border-black/10 bg-black/[.02] text-brand-gray/60'
                          } ${mine ? 'ring-2 ring-brand-green-dark' : ''} ${
                            cell.day === focus?.day ? 'ring-2 ring-offset-1 ring-brand-ink' : ''
                          }`}
                        >
                          <span className="block text-[10px] font-semibold uppercase">
                            {DAY_LABELS[fromDay(cell.day).getDay()]}
                          </span>
                          <span className="block text-[11px] font-bold">
                            {fromDay(cell.day).getDate()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {readOnly && (
          <div className="rounded-lg border border-black/10 bg-black/[.03] px-3 py-2 text-sm text-brand-gray">
            <p className="font-semibold text-brand-ink">This job is finished</p>
            <p>
              The times and notes below are the record of what was worked. Nothing here can be
              changed.
            </p>
          </div>
        )}

        {!readOnly && publishedVersion != null && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">Published schedule (v{publishedVersion})</p>
            <p>
              The crew already has these details. Changing the shift or the notes needs a
              reason, kept in this job&apos;s change history.
            </p>
          </div>
        )}

        {/* The shift. The phase's covers every day; any single day can be given
            its own, for the 6 AM delivery or the half day before a holiday. */}
        <div className="rounded-lg border border-black/10 p-3">
          {readOnly ? (
            <p className="text-sm text-brand-ink">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray">
                Shift:{' '}
              </span>
              {shiftLabel(draftShift)}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="label">Daily Start Time</label>
                  <input
                    className="input w-36"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Hours On Site</label>
                  <input
                    className="input w-28"
                    type="number"
                    min="0"
                    max="24"
                    step="0.25"
                    placeholder="all day"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                  />
                </div>
                {/* The two shapes a day usually takes, so splitting one between
                    two jobs is two clicks rather than four fields. */}
                <div className="flex flex-wrap gap-1 pb-1">
                  {SHIFT_PRESETS.map((preset) => {
                    const on = draftStartTime === preset.startTime && draftHours === preset.hours;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setStartTime(preset.startTime ?? '');
                          setHours(preset.hours == null ? '' : String(preset.hours));
                        }}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                          on
                            ? 'border-brand-green bg-brand-green/15 text-brand-green-dark'
                            : 'border-black/15 text-brand-gray hover:border-brand-green/50 hover:text-brand-ink'
                        }`}
                        title={preset.hint}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="mt-1.5 text-xs text-brand-gray">
                <span className="font-semibold text-brand-ink">{shiftLabel(draftShift)}</span>{' '}
                {draftHours == null
                  ? draftStartTime
                    ? '— on site the whole day from then. Put hours on it only to free the rest of the day up for another job.'
                    : '— every day of this phase, on the crew’s normal hours. Jobs book all day unless you give them hours.'
                  : '— every day of this phase. Anybody on it can take a second job outside those hours without being double-booked.'}
              </p>
            </>
          )}

          {workingDays.length > 0 && (
            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto border-t border-black/5 pt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                Day by day
              </p>
              {workingDays.map((day) => {
                const overridden = dayTimes.has(day);
                const shift = overridden ? dayTimes.get(day)! : draftShift;
                const crew = byDay.get(day) ?? [];
                return (
                  <div
                    key={day}
                    className={`flex flex-wrap items-center gap-2 rounded py-0.5 text-sm ${
                      day === focus?.day ? 'bg-brand-green/10 ring-1 ring-inset ring-brand-green/40' : ''
                    }`}
                  >
                    <span className="w-28 shrink-0 pl-1 font-medium text-brand-ink">
                      {fromDay(day).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    {readOnly ? (
                      <span className="w-40 shrink-0 text-brand-gray">{shiftLabel(shift)}</span>
                    ) : (
                      <>
                        <input
                          className="input w-28"
                          type="time"
                          value={overridden ? shift.startTime ?? '' : ''}
                          // A blank box on a day that already has an override
                          // means "no set time that day", which is how one day
                          // opts out.
                          onChange={(e) => setDayTime(day, e.target.value)}
                        />
                        <input
                          className="input w-20"
                          type="number"
                          min="0"
                          max="24"
                          step="0.25"
                          placeholder="all day"
                          value={overridden && shift.hours != null ? String(shift.hours) : ''}
                          onChange={(e) => setDayHours(day, e.target.value)}
                        />
                        {overridden ? (
                          <button
                            type="button"
                            className="text-xs font-medium text-brand-green-dark hover:underline"
                            onClick={() => clearDayTime(day)}
                            title="Follow the phase's daily shift again"
                          >
                            {shiftLabel(shift)} · use phase shift
                          </button>
                        ) : (
                          <span className="text-xs text-brand-gray">{shiftLabel(shift)}</span>
                        )}
                      </>
                    )}
                    <span className="flex flex-wrap items-center gap-1">
                      {crew.length === 0 ? (
                        <span className="text-xs text-brand-gray/70">
                          {task.subcontractor_name
                            ? `${task.subcontractor_name} (subcontracted)`
                            : 'nobody booked'}
                        </span>
                      ) : (
                        crew.map((c) => {
                          const key = `${day}:${c.kind}:${c.ref_id}`;
                          const mine =
                            focus != null && c.kind === focus.kind && c.ref_id === focus.refId;
                          const chip = `rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            mine
                              ? 'bg-brand-green/30 text-brand-green-dark ring-1 ring-brand-green'
                              : 'bg-brand-green/15 text-brand-green-dark'
                          }`;
                          return readOnly ? (
                            <span key={c.id} className={chip}>
                              {c.name}
                              {c.kind === 'sub' && <span className="opacity-70"> · sub</span>}
                            </span>
                          ) : (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => unassign(day, c.kind, c.ref_id)}
                              disabled={removing === key}
                              title={`Take ${c.name} off ${shortDate(day)}`}
                              className={`${chip} hover:bg-red-100 hover:text-red-700 disabled:opacity-50`}
                            >
                              {c.name}
                              {c.kind === 'sub' && <span className="opacity-70"> · sub</span>} ×
                            </button>
                          );
                        })
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="label">Notes For The Crew</label>
          {readOnly ? (
            <p className="whitespace-pre-wrap rounded-lg border border-black/10 bg-black/[.02] px-3 py-2 text-sm text-brand-ink">
              {notes.trim() === '' ? 'No notes were written for this phase.' : notes}
            </p>
          ) : (
            <>
              <textarea
                className="input min-h-[80px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Park on the north side, ask for Danny at the desk, hard hats required past the gate"
              />
              <p className="mt-1 text-xs text-brand-gray">
                Everyone booked on this phase sees this on their own schedule and in the schedule
                email, alongside the day they&apos;re working.
              </p>
            </>
          )}
        </div>

        {/* The job's own notes for whoever works it. Written on the job and
            read here, because this is where the day is being looked at. */}
        {crewNotes.length > 0 && (
          <div>
            <label className="label">Job Notes For The Crew</label>
            <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-black/10 bg-black/[.02] px-3 py-2">
              {crewNotes.map((n) => (
                <li key={n.id} className="text-sm text-brand-ink">
                  {n.pinned && (
                    <span className="mr-1 font-semibold text-brand-green-dark">Important:</span>
                  )}
                  <span className="whitespace-pre-wrap">{n.body}</span>
                  <span className="ml-1 text-xs text-brand-gray">
                    — {n.author_name}, {dateTime(n.created_at)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-brand-gray">
              Notes on the job itself, for everybody who works it. Add or edit them on the
              job&apos;s Notes tab.
            </p>
          </div>
        )}

        {!readOnly && (publishedVersion != null || changes.length > 0) && (
          <div>
            <label className="label">
              Reason For Change{' '}
              {reasonRequired ? '*' : <span className="text-brand-gray">(optional)</span>}
            </label>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Delivery moved to 6 AM Tuesday"
            />
            {changes.length > 0 && (
              <p className="mt-1 text-xs text-brand-gray">
                Will be logged as: {summarizeChanges(changes)}
              </p>
            )}
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button
              className="btn-primary"
              onClick={submit}
              disabled={saving || (reasonRequired && reason.trim() === '')}
              title={
                reasonRequired && reason.trim() === ''
                  ? 'A reason is required to change a published schedule'
                  : undefined
              }
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** One labelled fact about the job. Dropped entirely when there's nothing in it. */
function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray">{label}</dt>
      <dd className="text-sm text-brand-ink">{value}</dd>
    </div>
  );
}

/**
 * The shifts a split day is actually made of. A morning and an afternoon at
 * eight-to-noon and noon-to-four cover the case this exists for; All day is the
 * default a job books for and the way back to it.
 */
const SHIFT_PRESETS: { label: string; startTime: string | null; hours: number | null; hint: string }[] =
  [
    { label: 'All day', startTime: null, hours: null, hint: 'On site the whole day — the default' },
    { label: 'Morning', startTime: '08:00', hours: 4, hint: '8:00 AM – 12:00 PM' },
    { label: 'Afternoon', startTime: '12:00', hours: 4, hint: '12:00 PM – 4:00 PM' },
  ];

/**
 * The hours box as a number: blank, zero or nonsense is all day, which is what
 * a job books for unless somebody says otherwise. Quarter-hours, matching what
 * the server stores, so the box never shows a number it didn't keep.
 */
function parseHours(value: string): number | null {
  const n = Number(value.trim());
  if (value.trim() === '' || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(24, Math.round(n * 4) / 4);
}

/** A tappable directions link for an address typed by hand. */
function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
