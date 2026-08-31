'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  assigneeBookings,
  computeSchedule,
  fromDay,
  today as todayNow,
} from '@/lib/schedule-math';
import type { ScheduleTaskRow, WarehouseDay } from '@/lib/types';
import {
  availableCrew,
  boardAlerts,
  crewWeekModel,
  dayBoard,
  nextDayWithWork,
  paginate,
  timelineModel,
  type TimelineProject,
} from './tv-board';
import { BOARD_BG, CARD, TEXT } from './tv-style';
import { TvCrew } from './TvCrew';
import { TvDay } from './TvDay';
import { TvTimeline } from './TvTimeline';
import { useScheduleLive } from '@/components/useScheduleLive';

/** How often the board pulls fresh rows from the server. */
const REFRESH_SECONDS = 90;
/** How often it re-checks what day it is — a board left on runs past midnight. */
const DAY_CHECK_SECONDS = 60;
/** Jobs per timeline screen. Past this the board pages instead of shrinking. */
const ROWS_PER_PAGE = 7;
/** People per crew-week screen, for the same reason. */
const CREW_PER_PAGE = 10;
/** Weeks of crew week on screen — the fortnight the Schedule itself opens on. */
const CREW_WEEKS = 2;
/** Where the paused screen is remembered, so a reload comes back to it. */
const HOLD_KEY = 'tv-hold';

type Slide = { kind: 'day' } | { kind: 'crew'; page: number } | { kind: 'timeline'; page: number };

/**
 * The office status board.
 *
 * A screen nobody touches: it signs in once, rotates between the day and the
 * weeks ahead, and re-reads the schedule every minute and a half so a change
 * saved on the Schedule shows up here without anybody going and getting it.
 * Every number on it is derived by the same solver the Schedule uses — this is
 * a second way of *looking* at that data, never a second copy of it.
 *
 * The whole thing is read-only on purpose. The only controls are the ones a
 * kiosk needs (pause, step, full screen), they stay invisible until a mouse
 * moves, and nothing here can change a booking.
 */
export function TvBoard({
  tasks,
  warehouse,
  workers,
  projects,
  holidays,
  logoSrc,
  serverDay,
  loadedAt,
  panel,
  rotateSeconds,
  weeks,
}: {
  tasks: ScheduleTaskRow[];
  warehouse: WarehouseDay[];
  /** Everybody active, so the board can say who has nothing booked. */
  workers: { id: number; name: string; schedulable: boolean }[];
  /** Every live job, including ones with nothing scheduled yet. */
  projects: TimelineProject[];
  holidays: string[];
  logoSrc: string;
  /** Today as the server sees it — what the first paint is drawn from. */
  serverDay: string;
  /** When these rows were read, so the board can say how fresh it is. */
  loadedAt: string;
  /** 'rotate' cycles the screens; the others pin the board to one of them. */
  panel: 'rotate' | 'today' | 'crew' | 'timeline';
  rotateSeconds: number;
  weeks: number;
}) {
  const router = useRouter();
  // The first paint has to match the server's, so the day starts as the
  // server's and only becomes the viewer's once we're on the client — a TV in
  // another timezone would otherwise hydrate with a different board.
  const [day, setDay] = useState(serverDay);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);

  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);
  const { windows } = useMemo(() => computeSchedule(tasks, calendar), [tasks, calendar]);
  const bookings = useMemo(
    () => assigneeBookings(tasks, windows, calendar),
    [tasks, windows, calendar]
  );

  const board = useMemo(() => dayBoard(bookings, warehouse, day), [bookings, warehouse, day]);
  const nextDay = useMemo(
    () => nextDayWithWork(bookings, warehouse, day, calendar),
    [bookings, warehouse, day, calendar]
  );
  const nextBoard = useMemo(
    () => dayBoard(bookings, warehouse, nextDay),
    [bookings, warehouse, nextDay]
  );
  const available = useMemo(() => availableCrew(workers, board), [workers, board]);
  const alerts = useMemo(
    () => boardAlerts(tasks, windows, bookings, calendar, day),
    [tasks, windows, bookings, calendar, day]
  );
  const model = useMemo(
    () => timelineModel(tasks, projects, windows, calendar, day, weeks),
    [tasks, projects, windows, calendar, day, weeks]
  );
  const pages = useMemo(() => paginate(model.rows, ROWS_PER_PAGE), [model]);
  const crew = useMemo(
    () => crewWeekModel(bookings, warehouse, workers, day, CREW_WEEKS),
    [bookings, warehouse, workers, day]
  );
  const crewPages = useMemo(() => paginate(crew.rows, CREW_PER_PAGE), [crew]);

  // Today, then where everybody is, then the weeks ahead — narrowing from the
  // day in front of the office to the shape of the month.
  const slides: Slide[] = useMemo(() => {
    const crewScreens: Slide[] = crewPages.map((_, i) => ({ kind: 'crew', page: i }));
    const timeline: Slide[] = pages.map((_, i) => ({ kind: 'timeline', page: i }));
    if (panel === 'today') return [{ kind: 'day' }];
    if (panel === 'crew') return crewScreens;
    if (panel === 'timeline') return timeline;
    return [{ kind: 'day' }, ...crewScreens, ...timeline];
  }, [crewPages, pages, panel]);

  // A board that has just lost a timeline page (a job finished, the rows now
  // fit one screen) must not sit on a slide that no longer exists.
  const index = Math.min(slide, slides.length - 1);
  const current = slides[index];

  /* ------------------------------------------------------------- Rotation */

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const id = setInterval(() => setSlide((s) => (s + 1) % slides.length), rotateSeconds * 1000);
    return () => clearInterval(id);
  }, [paused, slides.length, rotateSeconds, index]);

  /* ------------------------------------------- Fresh data, and a fresh day */

  // Pushed the instant anybody saves, rather than waiting out the poll below —
  // which stays as it was, a backstop for a screen nobody will ever notice has
  // gone quiet.
  useScheduleLive();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_SECONDS * 1000);
    // A TV that was asleep, or a tab brought back to the front, is showing
    // whatever it had when it went away — read again the moment it's visible.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setDay(todayNow());
        router.refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = todayNow();
      setDay((d) => {
        // Midnight on a board left running: roll the day over and re-read, so
        // the morning shift walks in to today rather than to yesterday.
        if (d === now) return d;
        router.refresh();
        return now;
      });
    }, DAY_CHECK_SECONDS * 1000);
    return () => clearInterval(id);
  }, [router]);

  // Take the viewer's own day as soon as we're on the client, in case the
  // server's timezone puts it on a different date.
  useEffect(() => setDay(todayNow()), []);

  /* --------------------------------------------------- Kiosk housekeeping */

  // Keep the panel awake. Best-effort: unsupported browsers simply don't, and
  // the lock is dropped whenever the tab is hidden, so it's re-taken on return.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let dropped = false;
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!wakeLock) return;
    const take = async () => {
      if (dropped || document.visibilityState !== 'visible') return;
      try {
        lock = await wakeLock.request('screen');
      } catch {
        // A browser that refuses (no user gesture, battery saver) just doesn't.
      }
    };
    void take();
    document.addEventListener('visibilitychange', take);
    return () => {
      dropped = true;
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => {});
    };
  }, []);

  const step = useCallback(
    (by: number) => {
      // Stepping by hand is somebody choosing a screen, so it holds there
      // rather than turning over two seconds later.
      setPaused(true);
      setSlide((s) => (slides.length + s + by) % slides.length);
    },
    [slides.length]
  );

  // A held screen is remembered, so a browser that reloads overnight — or a TV
  // that reboots — comes back to the screen somebody left up rather than to the
  // rotation they deliberately stopped.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HOLD_KEY);
      if (!raw) return;
      const held = JSON.parse(raw) as { paused?: boolean; slide?: number };
      if (!held?.paused) return;
      setPaused(true);
      if (typeof held.slide === 'number' && held.slide >= 0) setSlide(held.slide);
    } catch {
      // A browser with storage blocked simply starts on the rotation.
    }
  }, []);

  useEffect(() => {
    try {
      if (paused) localStorage.setItem(HOLD_KEY, JSON.stringify({ paused: true, slide: index }));
      else localStorage.removeItem(HOLD_KEY);
    } catch {
      // Not being able to remember the hold doesn't stop it holding now.
    }
  }, [paused, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key.toLowerCase() === 'f') void toggleFullscreen();
      else if (e.key.toLowerCase() === 'r') router.refresh();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, router]);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden p-[1.2vw] text-white"
      style={{ background: BOARD_BG }}
    >
      <header className="flex items-center justify-between gap-6 pb-[1vw]">
        <div className="flex min-w-0 items-center gap-[1vw]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt=""
            className="h-[clamp(1.8rem,2.6vw,4rem)] w-auto max-w-[16vw] object-contain"
          />
          <div className="min-w-0">
            <p className={`${TEXT.eyebrow} text-brand-green`}>Schedule status board</p>
            <p className={`${TEXT.small} truncate text-white/45`}>
              {board.jobs.length} {board.jobs.length === 1 ? 'job' : 'jobs'} on site ·{' '}
              {model.rows.length} scheduled over the next {weeks}{' '}
              {weeks === 1 ? 'week' : 'weeks'}
            </p>
          </div>
        </div>
        <TvClock day={day} loadedAt={loadedAt} />
      </header>

      {alerts.length > 0 && (
        <div className="flex flex-wrap gap-[0.6vw] pb-[0.9vw]">
          {alerts.slice(0, 3).map((a) => (
            <span
              key={a.text}
              className={`${TEXT.small} rounded-lg px-3 py-1.5 font-semibold ${
                a.kind === 'clash'
                  ? 'bg-red-500/20 text-red-300'
                  : a.kind === 'hard-finish'
                    ? 'bg-status-progress/20 text-status-progress'
                    : 'bg-white/[0.07] text-white/70'
              }`}
            >
              {a.text}
            </span>
          ))}
        </div>
      )}

      {current.kind === 'day' ? (
        <TvDay board={board} next={nextBoard} available={available} today={day} />
      ) : current.kind === 'crew' ? (
        <TvCrew
          model={crew}
          rows={crewPages[current.page] ?? []}
          pages={crewPages.length}
          firstRow={current.page * CREW_PER_PAGE + 1}
          today={day}
          holidays={calendar.holidays}
        />
      ) : (
        <TvTimeline
          model={model}
          rows={pages[current.page] ?? []}
          page={current.page}
          pages={pages.length}
          firstRow={current.page * ROWS_PER_PAGE + 1}
          today={day}
          holidays={calendar.holidays}
        />
      )}

      <footer className="flex items-center justify-between gap-6 pt-[0.9vw]">
        <div className="flex items-center gap-2">
          {slides.map((s, i) => (
            <span
              key={s.kind === 'day' ? 'day' : `${s.kind}-${s.page}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === index ? 'w-8 bg-brand-green' : 'w-3 bg-white/20'
              }`}
            />
          ))}
          {/* The dwell bar: how long this screen has left before it turns over. */}
          {slides.length > 1 && !paused && (
            <span className="ml-2 h-1.5 w-[10vw] overflow-hidden rounded-full bg-white/10">
              <span
                key={index}
                className="tv-sweep block h-full w-full rounded-full bg-white/30"
                style={{ animationDuration: `${rotateSeconds}s` }}
              />
            </span>
          )}
          {paused && (
            <span className={`${TEXT.micro} ml-2 font-semibold text-brand-green`}>
              Holding on this screen
            </span>
          )}
        </div>

        {/* Always on screen, dimmed until somebody walks up to it: a board you
            can't stop on the screen you're reading is a board you fight. */}
        <div className="flex items-center gap-2 opacity-50 transition-opacity duration-200 hover:opacity-100">
          <Control onClick={() => step(-1)} label="Previous screen">
            ‹
          </Control>
          <Control
            onClick={() => setPaused((p) => !p)}
            label={paused ? 'Resume the rotation' : 'Hold this screen'}
          >
            <span className="font-semibold">{paused ? '▶ Resume' : '❚❚ Pause'}</span>
          </Control>
          <Control onClick={() => step(1)} label="Next screen">
            ›
          </Control>
          <Control onClick={() => void toggleFullscreen()} label="Full screen">
            ⛶
          </Control>
          <Link
            href="/schedule"
            className={`${TEXT.micro} rounded-lg border border-white/15 px-3 py-1.5 font-semibold text-white/70 hover:bg-white/10`}
          >
            Schedule
          </Link>
        </div>
      </footer>
    </div>
  );
}

/** A kiosk control: only there for the person who walked up to the screen. */
function Control({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${TEXT.micro} rounded-lg border border-white/15 px-3 py-1.5 text-white/70 hover:bg-white/10`}
    >
      {children}
    </button>
  );
}

/**
 * The wall clock, and how fresh the board is.
 *
 * Its own component so the second hand doesn't re-render the schedule behind
 * it, and blank until mounted so the server's clock never hydrates into a
 * different one.
 */
function TvClock({ day, loadedAt }: { day: string; loadedAt: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="shrink-0 text-right">
      <p className={`${TEXT.clock} font-semibold leading-none tabular-nums text-white`}>
        {now
          ? now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : ' '}
      </p>
      <p className={`${TEXT.micro} mt-1 text-white/40`}>
        {fromDay(day).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })}
        {now && (
          <>
            {' · updated '}
            {new Date(loadedAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </>
        )}
      </p>
    </div>
  );
}

/** Go full screen, or come back out of it. Ignored where it isn't allowed. */
async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    // Some TV browsers refuse without a gesture they recognise; not worth a
    // message on a screen nobody is standing at.
  }
}
