'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { shortDate } from '@/lib/format';
import { DAY_LABELS, fromDay } from '@/lib/schedule-math';
import { setDayOffAction } from '@/app/actions/schedule';

/**
 * A day of the crew week's header, and the switch that closes it.
 *
 * Marking a day off is a scheduling decision made while looking at the
 * schedule: the office is shut on Thanksgiving, the shop is closed Friday for
 * the shutdown — so the day itself is the control. Click it and the day is
 * blocked: every phase's duration skips it, every projected date shifts around
 * it, and nobody can be booked on it. Click it again and it opens back up.
 *
 * It writes straight through rather than joining the schedule draft. A day off
 * isn't one job's dates — it moves every job at once, and it's the ground the
 * rest of the board's arithmetic stands on — so it lands, the board re-reads,
 * and everybody else's board re-reads with it. That's also why the label goes
 * on before the day is blocked rather than after: the whole company sees this
 * day, and "off" with nothing beside it is a day somebody will ask about.
 *
 * Weekends aren't offered. They're already skipped everywhere, so blocking one
 * would be a row that changes nothing.
 */
export function DayOffControl({
  day,
  weekend,
  off,
  label,
  worked,
  isToday,
  booked,
}: {
  day: string;
  /** Saturday or Sunday: always off, and nothing here to change. */
  weekend: boolean;
  /** The day is blocked — a holiday or a shutdown day. */
  off: boolean;
  /** What it was blocked for, when somebody said. */
  label: string | null;
  /** Somebody is booked on this off day: it happened before the day was closed. */
  worked: boolean;
  isToday: boolean;
  /** How many people are booked that day, across the weeks on screen. */
  booked: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /** Where the panel is pinned, in viewport coordinates. */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Clicking anywhere else, or pressing Escape, puts the panel away. Without
  // this it would sit open over the grid somebody went back to reading. So does
  // scrolling or resizing: the panel is pinned to where the date was, and one
  // floating away from its own day is worse than no panel at all.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (box.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function away() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', away);
    // Capture, so the grid's own sideways scroll closes it too.
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [open]);

  const dow = DAY_LABELS[fromDay(day).getDay()];
  const num = fromDay(day).getDate();
  const tone = isToday
    ? 'text-brand-green-dark'
    : worked
      ? 'text-amber-700'
      : off
        ? 'text-brand-gray/60'
        : 'text-brand-gray';

  if (weekend) {
    return (
      <span
        className={`text-[11px] font-semibold ${tone}`}
        title="Saturday and Sunday are always off"
      >
        {dow} {num}
        <span className="ml-1 font-normal">{worked ? '(worked)' : '(off)'}</span>
      </span>
    );
  }

  function submit(nextOff: boolean) {
    setError(null);
    start(async () => {
      const res = await setDayOffAction(day, nextOff, nextOff ? draftLabel : null);
      if (!res.ok) {
        setError(res.error ?? 'Could not change that day.');
        return;
      }
      setDraftLabel('');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={(e) => {
          setError(null);
          setDraftLabel(label ?? '');
          setAt(place(e.currentTarget.getBoundingClientRect()));
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-pressed={off}
        title={
          off
            ? `${shortDate(day)} is marked off${
                label ? ` — ${label}` : ''
              }\nNothing can be booked on it. Click to open the day back up.`
            : `${shortDate(day)}\nClick to mark the day off — a holiday or a shutdown day nobody works`
        }
        className={`-mx-1 block max-w-full rounded px-1 text-left text-[11px] font-semibold hover:bg-black/5 ${tone}`}
      >
        <span className="block truncate">
          {dow} {num}
          {off && <span className="ml-1 font-normal">{worked ? '(worked)' : '(off)'}</span>}
        </span>
        {off && label && (
          <span className="block truncate text-[9px] font-medium leading-tight text-brand-gray/70">
            {label}
          </span>
        )}
      </button>

      {/* Drawn in a portal, pinned to the date it belongs to. The grid it sits
          in scrolls sideways inside a clipped box, and a panel drawn inside
          that box loses its right-hand half on the last few columns — which is
          exactly where a shutdown Friday tends to be. */}
      {open &&
        at &&
        createPortal(
          <div
            ref={panel}
            style={{ position: 'fixed', left: at.left, top: at.top }}
            className="z-50 w-[248px] rounded-lg border border-black/10 bg-white p-3 shadow-lg"
          >
            <p className="text-xs font-semibold text-brand-ink">
              {fromDay(day).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </p>

            {off ? (
              <>
                <p className="mt-1 text-[11px] text-brand-gray">
                  Marked off{label ? ` — ${label}` : ''}. Nothing can be booked on it, and every
                  phase running through it is a day longer.
                </p>
                <button
                  className="btn-secondary mt-3 w-full py-1.5 text-xs"
                  onClick={() => submit(false)}
                  disabled={pending}
                >
                  {pending ? 'Saving…' : 'Open the day back up'}
                </button>
              </>
            ) : (
              <>
                <p className="mt-1 text-[11px] text-brand-gray">
                  Off for everybody: nobody can be booked on it, and every projected date shifts
                  around it.
                </p>
                <label className="label mt-2 text-[11px]">What for (optional)</label>
                <input
                  className="input h-8 py-1 text-xs"
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  placeholder="Thanksgiving"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit(true);
                  }}
                />
                {/* Days already booked are left where they are: deleting
                    somebody's day out from under them to close the day is the
                    worse surprise. So it's said here, and the header marks the
                    day "worked" until they're taken off. */}
                {booked > 0 && (
                  <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                    {booked} {booked === 1 ? 'person is' : 'people are'} already booked that day.
                    They stay booked — the day shows as worked until you take them off.
                  </p>
                )}
                <button
                  className="btn-primary mt-3 w-full py-1.5 text-xs"
                  onClick={() => submit(true)}
                  disabled={pending}
                >
                  {pending ? 'Saving…' : 'Mark the day off'}
                </button>
              </>
            )}

            {error && (
              <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                {error}
              </p>
            )}

            <p className="mt-2 text-[10px] text-brand-gray/80">
              Every non-working day, in one calendar: Settings → Non-Working Days.
            </p>
          </div>,
          document.body
        )}
    </div>
  );
}

/** The panel's own size, for keeping it on screen. */
const PANEL_W = 248;
const PANEL_H = 260;

/**
 * Where to pin the panel for a date at `rect`: under it and left-aligned by
 * default, pulled back from whichever edge it would otherwise run off. The last
 * column of a fortnight sits at the right of the screen, and a day off is every
 * bit as likely to be a Friday as a Monday.
 */
function place(rect: DOMRect): { left: number; top: number } {
  const pad = 8;
  const left = Math.max(pad, Math.min(rect.left, window.innerWidth - PANEL_W - pad));
  const below = rect.bottom + 4;
  const top = below + PANEL_H > window.innerHeight ? Math.max(pad, rect.top - PANEL_H - 4) : below;
  return { left, top };
}
