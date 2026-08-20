'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/Modal';
import { shortDate } from '@/lib/format';
import {
  crewBudget,
  crewByDay,
  eachDay,
  fromDay,
  isWorkingDay,
  timeLabel,
  type ComputedWindow,
} from '@/lib/schedule-math';
import { diffTask, needsReason, summarizeChanges } from '@/lib/schedule-diff';
import type { ScheduleTaskRow, TaskDayTime } from '@/lib/types';
import { TASK_STATUS_LABELS } from '@/lib/types';
import {
  assignCrewSpanAction,
  saveCrewCardAction,
  unassignCrewDayAction,
  unassignCrewSpanAction,
} from '@/app/actions/schedule';

/** Whose booking is open, when the card was opened from somebody's row. */
export interface CardPerson {
  kind: 'user' | 'sub';
  refId: number;
  name: string;
  /** Role for an employee, trade for a sub. */
  detail: string | null;
  /** True for the sub who holds the phase — their days follow its dates. */
  contracted: boolean;
}

/**
 * One job's card, opened from the crew week — from a phase's card in the work
 * band, or by clicking somebody's booking in the grid.
 *
 * This is the crew-facing half of a phase: the job it belongs to, what time
 * they start, which single days start at a different time, and what they need to
 * know before they turn up. All of it belongs here rather than on the timeline
 * because none of it makes sense without the days in front of you — a 6 AM
 * delivery is a fact about a Tuesday, not about a bar on a Gantt chart.
 *
 * Opened from a person's booking it is that person's entry: the job's details,
 * the days THEY are on, tickable one by one so a stretch can be stretched or
 * trimmed here rather than back out on the grid, and a way to take them off the
 * phase altogether.
 *
 * Who is booked shows here too, day by day, so a card is one place to read
 * "this is the job, this is the crew, this is when they start". On a
 * subcontracted phase the sub isn't listed per day and can't be taken off one:
 * they hold the whole phase, so their days follow its dates and change on the
 * timeline.
 */
export function CrewJobCard({
  task,
  window,
  holidays,
  publishedVersion,
  person,
  onClose,
  onSaved,
}: {
  task: ScheduleTaskRow;
  /** The phase's computed window — the days a time can be set on. */
  window: ComputedWindow | undefined;
  holidays: string[];
  /** The job's published version, when its schedule has gone out. */
  publishedVersion?: number | null;
  /** Set when the card was opened from one person's booking on the grid. */
  person?: CardPerson;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [startTime, setStartTime] = useState(task.start_time ?? '');
  // Presence in the map is an override for that day; a null value is an
  // override that says "no set time on this day".
  const [dayTimes, setDayTimes] = useState<Map<string, string | null>>(
    () => new Map((task.day_times ?? []).map((d) => [d.day, d.start_time]))
  );
  const [notes, setNotes] = useState(task.notes ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  /** The days this person is on the phase, as the editor has them now. */
  const originalDays = useMemo(
    () =>
      new Set(
        person
          ? (task.crew_days ?? [])
              .filter((c) => c.kind === person.kind && c.ref_id === person.refId)
              .map((c) => c.day)
          : []
      ),
    [task, person]
  );
  const [myDays, setMyDays] = useState<Set<string>>(originalDays);

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

  const draftStartTime = startTime.trim() === '' ? null : startTime.trim();

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
      .map(([day, start_time]) => ({ day, start_time }));
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
      { ...base, start_time: task.start_time ?? null, day_times: task.day_times ?? [], notes: task.notes },
      {
        ...base,
        start_time: draftStartTime,
        day_times: draftDayTimes,
        notes: notes.trim() === '' ? null : notes.trim(),
      },
      { phase: () => task.name, sub: () => task.subcontractor_name ?? 'a subcontractor' }
    );
  }, [task, draftStartTime, draftDayTimes, notes]);

  const reasonRequired = needsReason(changes, publishedVersion != null);

  /** Give one day its own start time; an empty value means "no time that day". */
  function setDayTime(day: string, value: string) {
    setDayTimes((prev) => new Map(prev).set(day, value.trim() === '' ? null : value.trim()));
  }

  /** Drop a day's override so it follows the phase's daily start time again. */
  function clearDayTime(day: string) {
    setDayTimes((prev) => {
      const next = new Map(prev);
      next.delete(day);
      return next;
    });
  }

  async function unassign(day: string, kind: 'user' | 'sub', refId: number) {
    setRemoving(`${day}:${kind}:${refId}`);
    const res = await unassignCrewDayAction({ task_id: task.id, day, kind, ref_id: refId });
    setRemoving(null);
    if (res.ok) onSaved();
    else setError(res.error ?? 'Could not take them off that day.');
  }

  /** Tick or untick one of this person's days on the phase. */
  function toggleMyDay(day: string) {
    setMyDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  // What ticking and unticking days would actually change.
  const addedDays = useMemo(
    () => [...myDays].filter((d) => !originalDays.has(d)).sort(),
    [myDays, originalDays]
  );
  const removedDays = useMemo(
    () => [...originalDays].filter((d) => !myDays.has(d)).sort(),
    [myDays, originalDays]
  );
  const daysChanged = addedDays.length > 0 || removedDays.length > 0;

  async function submit() {
    setError(null);
    setSaving(true);

    // The phase's own fields first — they're the half that can need a reason.
    if (changes.length > 0 || reason.trim() !== '') {
      const res = await saveCrewCardAction({
        task_id: task.id,
        start_time: draftStartTime,
        day_times: draftDayTimes,
        notes,
        reason,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not save.');
        setSaving(false);
        return;
      }
    }

    // Then this person's days. Days come off before others go on, so trimming
    // one end of a stretch frees the budget the other end needs.
    if (person && !person.contracted && daysChanged) {
      const who = { task_id: task.id, kind: person.kind, ref_id: person.refId };
      if (removedDays.length > 0) {
        const res = await unassignCrewSpanAction({ ...who, days: removedDays });
        if (!res.ok) {
          setError(res.error ?? 'Could not take them off those days.');
          setSaving(false);
          return;
        }
      }
      if (addedDays.length > 0) {
        const res = await assignCrewSpanAction({ ...who, days: addedDays });
        if (!res.ok) {
          setError(res.error ?? 'Could not book those days.');
          setSaving(false);
          return;
        }
      }
    }

    onSaved();
  }

  /** Take this person off the phase altogether. */
  async function removeFromPhase() {
    if (!person || person.contracted) return;
    const days = [...originalDays].sort();
    if (days.length === 0) {
      onClose();
      return;
    }
    if (
      !confirm(
        `Take ${person.name} off ${task.name}? That drops ${days.length} ${
          days.length === 1 ? 'day' : 'days'
        } of theirs on this phase.`
      )
    ) {
      return;
    }
    setSaving(true);
    const res = await unassignCrewSpanAction({
      task_id: task.id,
      days,
      kind: person.kind,
      ref_id: person.refId,
    });
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not take them off this phase.');
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        person
          ? `${person.name} — ${task.project_name}`
          : `${task.name} — ${task.project_name}`
      }
      wide
    >
      <div className="space-y-4">
        {/* The job itself, so a booking can be read without leaving it: what the
            work is, where, and what the phase was planned as. */}
        <div className="rounded-lg border border-black/10 bg-black/[.02] px-4 py-3 text-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">
            Job details
          </p>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            <Detail label="Job" value={task.project_name} />
            <Detail label="Customer" value={task.customer} />
            <Detail label="Phase" value={task.name} />
            <Detail label="Status" value={TASK_STATUS_LABELS[task.status]} />
            <Detail
              label="Runs"
              value={window ? `${shortDate(window.start)} → ${shortDate(window.end)}` : 'No dates yet'}
            />
            <Detail
              label="Planned crew"
              value={
                budget.needed > 0
                  ? `${budget.needed} a day × ${budget.days} ${budget.days === 1 ? 'day' : 'days'}`
                  : 'None of ours'
              }
            />
            {task.location && <Detail label="Location" value={task.location} />}
            {task.subcontractor_name && (
              <Detail label="Subcontractor" value={task.subcontractor_name} />
            )}
            {person && (
              <Detail
                label="Assigned"
                value={`${person.name}${person.detail ? ` — ${person.detail}` : ''}${
                  person.kind === 'sub' ? ' · sub' : ''
                }`}
              />
            )}
          </dl>
        </div>

        <div className="rounded-lg border border-black/10 bg-black/[.02] px-4 py-3 text-sm">
          <p className="font-semibold text-brand-ink">
            {window ? `${shortDate(window.start)} → ${shortDate(window.end)}` : 'No dates yet'}
          </p>
          <p className="mt-0.5 text-brand-gray">{task.customer}</p>
          {task.subcontractor_name && (
            <p className="mt-1 font-medium text-brand-ink">
              Subcontracted to {task.subcontractor_name} — on site all {budget.days} working{' '}
              {budget.days === 1 ? 'day' : 'days'}
            </p>
          )}
          {budget.capacity > 0 ? (
            <p className="mt-1 font-medium text-brand-ink">
              {task.subcontractor_name ? 'Our crew: ' : ''}
              {budget.filled} of {budget.capacity} crew {budget.capacity === 1 ? 'day' : 'days'}{' '}
              booked · {budget.needed} a day for {budget.days} working{' '}
              {budget.days === 1 ? 'day' : 'days'}
            </p>
          ) : (
            !task.subcontractor_name && (
              <p className="mt-1 font-medium text-brand-ink">Nobody booked on this phase</p>
            )
          )}
          {task.site_address && (
            <a
              href={mapsUrl(task.site_address)}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block text-brand-green-dark hover:underline"
            >
              {task.site_address}
            </a>
          )}
          <Link
            href={`/projects/${task.project_id}`}
            className="mt-1 inline-block text-xs font-medium text-brand-green-dark hover:underline"
          >
            Open the job →
          </Link>
        </div>

        {publishedVersion != null && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">Published schedule (v{publishedVersion})</p>
            <p>
              The crew already has these details. Changing a start time or the notes needs a
              reason, kept in this job&apos;s change history.
            </p>
          </div>
        )}

        {/* This person's days on the phase. Every day of its window is here, so
            a stretch can be pushed out, pulled back, or split without going
            back to the grid — including a weekend, which is an extra day of
            work rather than a slice of the planned ones. */}
        {person && window && (
          <div className="rounded-lg border border-black/10 p-3">
            <label className="label">
              Days Worked{person.contracted ? '' : ' (tick the days they are on)'}
            </label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {eachDay(window.start, window.end).map((day) => {
                const on = person.contracted ? isWorkingDay(day, calendar) : myDays.has(day);
                const off = !isWorkingDay(day, calendar);
                const d = fromDay(day);
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={person.contracted || saving}
                    onClick={() => toggleMyDay(day)}
                    title={
                      person.contracted
                        ? `${person.name} holds this phase — their days follow its dates`
                        : `${on ? 'Take them off' : 'Put them on'} ${shortDate(day)}${
                            off ? ' (a non-working day)' : ''
                          }`
                    }
                    className={`w-[62px] rounded-lg border px-1 py-1.5 text-center text-[11px] leading-tight transition-colors disabled:cursor-default ${
                      on
                        ? 'border-brand-green bg-brand-green/20 font-semibold text-brand-ink'
                        : 'border-black/10 text-brand-gray hover:bg-black/5'
                    } ${off ? 'italic' : ''}`}
                  >
                    <span className="block">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                    <span className="block">
                      {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-brand-gray">
              {person.contracted
                ? `${person.name} holds this phase, so they're on site every working day of it — the dates move on the Job Timeline.`
                : `${myDays.size} ${myDays.size === 1 ? 'day' : 'days'} for ${person.name}` +
                  (daysChanged
                    ? ` · ${[
                        addedDays.length > 0 ? `+${addedDays.length}` : null,
                        removedDays.length > 0 ? `−${removedDays.length}` : null,
                      ]
                        .filter(Boolean)
                        .join(' ')} on save`
                    : '') +
                  ` · ${budget.remaining} crew ${
                    budget.remaining === 1 ? 'day' : 'days'
                  } left on the phase`}
            </p>
            {!person.contracted && addedDays.length > budget.remaining && (
              <p className="mt-1 text-xs font-medium text-amber-700">
                That&apos;s more days than the phase has budget for — the first{' '}
                {budget.remaining} will land and the rest won&apos;t. Raise the crew it needs on the
                timeline, or take somebody off another day.
              </p>
            )}
          </div>
        )}

        {/* Start times. The phase time covers every day; any single day can be
            given its own, for the 6 AM delivery or the late inspection. */}
        <div className="rounded-lg border border-black/10 p-3">
          <label className="label">Daily Start Time</label>
          <input
            className="input w-40"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <p className="mt-1 text-xs text-brand-gray">
            {draftStartTime
              ? `The crew starts at ${timeLabel(draftStartTime)} on every day of this phase.`
              : 'Leave empty and the crew works their normal hours.'}
          </p>

          {workingDays.length > 0 && (
            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto border-t border-black/5 pt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                Day by day
              </p>
              {workingDays.map((day) => {
                const overridden = dayTimes.has(day);
                const value = overridden ? dayTimes.get(day) ?? '' : '';
                const crew = byDay.get(day) ?? [];
                return (
                  <div key={day} className="flex flex-wrap items-center gap-2 py-0.5 text-sm">
                    <span className="w-28 shrink-0 font-medium text-brand-ink">
                      {fromDay(day).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <input
                      className="input w-32"
                      type="time"
                      value={value}
                      // A blank box on a day that already has an override means
                      // "no set time that day", which is how one day opts out.
                      onChange={(e) => setDayTime(day, e.target.value)}
                    />
                    {overridden ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-brand-green-dark hover:underline"
                        onClick={() => clearDayTime(day)}
                        title="Follow the phase's daily start time again"
                      >
                        {value === '' ? 'no set time · use phase time' : 'use phase time'}
                      </button>
                    ) : (
                      <span className="text-xs text-brand-gray">
                        {draftStartTime ? timeLabel(draftStartTime) : 'no set time'}
                      </span>
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
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => unassign(day, c.kind, c.ref_id)}
                              disabled={removing === key}
                              title={`Take ${c.name} off ${shortDate(day)}`}
                              className="rounded bg-brand-green/15 px-1.5 py-0.5 text-[11px] font-medium text-brand-green-dark hover:bg-red-100 hover:text-red-700 disabled:opacity-50"
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
        </div>

        {(publishedVersion != null || changes.length > 0) && (
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

        <div className="flex flex-wrap items-center justify-between gap-2">
          {person && !person.contracted ? (
            <button
              className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              onClick={removeFromPhase}
              disabled={saving}
              title={`Take ${person.name} off every day of this phase`}
            >
              Remove From Phase
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
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
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** One labelled fact about the job, as the details grid lists it. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray">{label}</dt>
      <dd className="truncate font-medium text-brand-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}

/** A tappable directions link for an address typed by hand. */
function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
