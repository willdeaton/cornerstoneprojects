'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { shortDate } from '@/lib/format';
import { addDays, eachDay, fromDay, isWeekend, toDay, today } from '@/lib/schedule-math';
import { saveHolidaysAction } from '@/app/actions/schedule';

/*
 * Picking non-working days off a calendar. Clicking a weekday blocks it,
 * clicking it again frees it, and shift-clicking carries the same change across
 * a run of days — a shutdown week is one click and one shift-click, not seven
 * trips through a date field.
 *
 * Nothing is written until Save: the picks are held as pending sets over the
 * saved list, so the whole batch lands in one round trip and one recompute of
 * every projected date.
 */

/** How many months the picker shows side by side on a wide screen. */
const PANELS = 2;

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** The first of the month a day falls in. */
function monthStart(day: string): string {
  return day.slice(0, 7) + '-01';
}

/** Shift a 'YYYY-MM-01' by whole months. */
function addMonths(month: string, n: number): string {
  const d = fromDay(month);
  d.setMonth(d.getMonth() + n);
  return monthStart(toDay(d));
}

function monthLabel(month: string): string {
  return fromDay(month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Weeks a month needs when drawn Sunday-first: 4 (rare), 5, or 6. */
function weeksIn(month: string): number {
  const first = fromDay(month);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return Math.ceil((first.getDay() + days) / 7);
}

/**
 * The weeks a month is drawn on, Sunday-first. `weeks` is passed in rather than
 * derived so the panels sharing a row are the same height — and so a month that
 * only needs five rows isn't padded with a blank sixth.
 */
function monthGrid(month: string, weeks: number): string[] {
  const gridStart = addDays(month, -fromDay(month).getDay());
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
}

export function HolidaysManager({
  holidays,
}: {
  holidays: { day: string; label: string | null }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const now = useMemo(() => today(), []);
  const [month, setMonth] = useState(() => monthStart(now));

  /* Saved state comes from the server on every refresh, so it's derived rather
     than copied into state — nothing to keep in sync after a save. */
  const blocked = useMemo(
    () => new Map(holidays.map((h) => [h.day, h.label] as const)),
    [holidays]
  );

  const [toBlock, setToBlock] = useState<Set<string>>(new Set());
  const [toFree, setToFree] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState('');
  /** Last day clicked, for shift-click ranges. */
  const [anchor, setAnchor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const dirty = toBlock.size > 0 || toFree.size > 0;

  /** Blocked as the calendar currently shows it — saved, plus pending edits. */
  function isBlocked(day: string): boolean {
    if (toFree.has(day)) return false;
    if (toBlock.has(day)) return true;
    return blocked.has(day);
  }

  /** Move `days` to blocked or free, folding the change into the pending sets. */
  function apply(days: string[], block: boolean) {
    const nextBlock = new Set(toBlock);
    const nextFree = new Set(toFree);
    for (const day of days) {
      if (isWeekend(day)) continue;
      if (block) {
        // Re-blocking a saved day just cancels its pending release.
        if (blocked.has(day)) nextFree.delete(day);
        else nextBlock.add(day);
      } else {
        if (blocked.has(day)) nextFree.add(day);
        else nextBlock.delete(day);
      }
    }
    setToBlock(nextBlock);
    setToFree(nextFree);
    setError(null);
  }

  function clickDay(day: string, shiftKey: boolean) {
    const block = !isBlocked(day);
    const days =
      shiftKey && anchor
        ? eachDay(anchor < day ? anchor : day, anchor < day ? day : anchor)
        : [day];
    apply(days, block);
    setAnchor(day);
  }

  function reset() {
    setToBlock(new Set());
    setToFree(new Set());
    setLabel('');
    setAnchor(null);
    setError(null);
  }

  function save() {
    setError(null);
    const text = label.trim();
    start(async () => {
      const res = await saveHolidaysAction(
        [...toBlock].sort().map((day) => ({ day, label: text || null })),
        [...toFree].sort()
      );
      if (!res.ok) {
        setError(res.error ?? 'Could not save.');
        return;
      }
      reset();
      router.refresh();
    });
  }

  const months = Array.from({ length: PANELS }, (_, i) => addMonths(month, i));
  /* One height for the row of panels: side-by-side months that end on
     different rows read as a rendering slip rather than a calendar. */
  const weeks = Math.max(...months.map(weeksIn));
  /* The list leads with the days still ahead — the ones that can still move a
     job — but days already past stay one click away rather than vanishing, so
     blocking a shutdown that has already run still shows up somewhere. */
  const past = holidays.filter((h) => h.day < now);
  const listed = showPast ? holidays : holidays.filter((h) => h.day >= now);

  return (
    <div className="space-y-4">
      <div className="card p-5">
        {/* One set of arrows for both panels: they page the whole picker. */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            className="btn-secondary px-2.5"
            onClick={() => setMonth(addMonths(month, -1))}
            aria-label="Previous month"
          >
            <Chevron dir="left" />
          </button>
          <div className="flex items-center gap-3">
            <p className="brand-heading text-sm text-brand-ink">{monthLabel(month)}</p>
            {monthStart(now) !== month && (
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setMonth(monthStart(now))}>
                Today
              </button>
            )}
          </div>
          <button
            className="btn-secondary px-2.5"
            onClick={() => setMonth(addMonths(month, 1))}
            aria-label="Next month"
          >
            <Chevron dir="right" />
          </button>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {months.map((m, i) => (
            <div key={m} className={i > 0 ? 'hidden sm:block' : undefined}>
              <p className="mb-2 text-center text-xs font-semibold text-brand-gray">
                {monthLabel(m)}
              </p>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_INITIALS.map((d, idx) => (
                  <div
                    key={idx}
                    className="pb-1 text-center text-[11px] font-semibold text-brand-gray/70"
                  >
                    {d}
                  </div>
                ))}
                {monthGrid(m, weeks).map((day) => (
                  <DayCell
                    key={day}
                    day={day}
                    inMonth={day.slice(0, 7) === m.slice(0, 7)}
                    isToday={day === now}
                    isPast={day < now}
                    blocked={isBlocked(day)}
                    saved={blocked.has(day)}
                    label={blocked.get(day) ?? null}
                    onPick={clickDay}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-surface-line pt-3 text-[11px] text-brand-gray">
          <Legend className="border-red-200 bg-red-50" text="Blocked" />
          <Legend className="border-dashed border-red-400 bg-red-50" text="Unsaved pick" />
          <Legend className="border-surface-line bg-surface-sunken" text="Weekend — always skipped" />
          <span className="ml-auto">Shift-click to block a run of days.</span>
        </div>
      </div>

      {dirty && (
        <div className="card border-brand-green/40 bg-brand-green/[0.06] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="label">
                Label {toBlock.size > 0 ? '(applies to the days being blocked)' : ''}
              </label>
              <input
                className="input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Thanksgiving"
                disabled={toBlock.size === 0}
              />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={reset} disabled={pending}>
                Cancel
              </button>
              <button className="btn-primary" onClick={save} disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          <p className="mt-3 text-sm text-brand-gray">{summarize(toBlock.size, toFree.size)}</p>
          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </div>
      )}

      {listed.length === 0 ? (
        <div className="card p-8 text-center text-sm text-brand-gray">
          No non-working days coming up. Weekends are always skipped.
        </div>
      ) : (
        <div className="card divide-y divide-black/5">
          {listed.map((h) => (
            <button
              key={h.day}
              className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-surface-sunken"
              onClick={() => setMonth(monthStart(h.day))}
            >
              <div>
                <p className={`font-medium ${h.day < now ? 'text-brand-gray' : 'text-brand-ink'}`}>
                  {shortDate(h.day)}
                </p>
                {h.label && <p className="text-sm text-brand-gray">{h.label}</p>}
              </div>
              <span className="text-xs font-medium text-brand-gray">Show on calendar</span>
            </button>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <button
          className="btn-ghost w-full text-xs"
          onClick={() => setShowPast(!showPast)}
        >
          {showPast
            ? 'Hide days already past'
            : `Show ${past.length} blocked ${past.length === 1 ? 'day' : 'days'} already past`}
        </button>
      )}
    </div>
  );
}

/** What Save is about to do, in the order it reads best. */
function summarize(block: number, free: number): string {
  const parts: string[] = [];
  if (block) parts.push(`Blocking ${block} ${block === 1 ? 'day' : 'days'}`);
  if (free) parts.push(`${parts.length ? 'freeing' : 'Freeing'} ${free} ${free === 1 ? 'day' : 'days'}`);
  return parts.join(', ') + '. Every projected end date moves to match.';
}

function DayCell({
  day,
  inMonth,
  isToday,
  isPast,
  blocked,
  saved,
  label,
  onPick,
}: {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  /** Behind us. Still blockable — the date math runs over history too. */
  isPast: boolean;
  blocked: boolean;
  /** Already stored, so a pending change to it shows as an edit not a new pick. */
  saved: boolean;
  label: string | null;
  onPick: (day: string, shiftKey: boolean) => void;
}) {
  const num = Number(day.slice(8));

  // Days spilling in from the neighbouring month belong to that panel; showing
  // them keeps the weeks intact, but clicking one there would be a mis-click.
  if (!inMonth) {
    return <div className="h-10 rounded-lg" aria-hidden />;
  }

  if (isWeekend(day)) {
    return (
      <div
        className="flex h-10 items-center justify-center rounded-lg border border-surface-line bg-surface-sunken text-sm text-brand-gray/50"
        title="Weekend — already skipped"
      >
        {num}
      </div>
    );
  }

  const pendingEdit = blocked !== saved;
  const classes = blocked
    ? `border-red-200 bg-red-50 text-red-700 hover:bg-red-100 ${pendingEdit ? 'border-dashed border-red-400' : ''}`
    : `border-surface-line bg-white hover:bg-surface-sunken ${isPast ? 'text-brand-gray/60' : 'text-brand-ink'} ${pendingEdit ? 'border-dashed border-brand-gray/50 line-through decoration-brand-gray/60' : ''}`;

  return (
    <button
      type="button"
      onClick={(e) => onPick(day, e.shiftKey)}
      aria-pressed={blocked}
      title={
        blocked
          ? `${shortDate(day)}${label ? ` — ${label}` : ''} · blocked, click to free`
          : `${shortDate(day)} · click to block`
      }
      className={`flex h-10 flex-col items-center justify-center rounded-lg border text-sm font-medium transition-colors duration-100 ${classes}`}
    >
      <span className={isToday ? 'rounded-full bg-brand-green px-1.5 text-brand-ink' : undefined}>
        {num}
      </span>
      {blocked && label && (
        <span className="w-full truncate px-1 text-[9px] font-normal leading-tight text-red-600/80">
          {label}
        </span>
      )}
    </button>
  );
}

function Legend({ className, text }: { className: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded border ${className}`} />
      {text}
    </span>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
      <path
        d={dir === 'left' ? 'M12.5 4 7 10l5.5 6' : 'M7.5 4 13 10l-5.5 6'}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
