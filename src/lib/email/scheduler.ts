import 'server-only';
import { sendProjectReminders, sendCompletionReport } from './send';

/*
 * Background cron scheduler for the SCHEDULED emails.
 *
 * The reference design uses APScheduler (BackgroundScheduler + CronTrigger).
 * This app has no such dependency, so we run a minute-tick loop that fires a
 * job when the current day-of-week + hour in the configured timezone match —
 * the same env-driven day/hour/tz semantics as a CronTrigger.
 *
 * Faithful to the design:
 *  - Started ONCE per worker (guarded with a run-once global flag).
 *  - coalesce: a job fires at most once per matching hour per process.
 *  - The singleton DB run-lock (acquired inside each handler with
 *    min_gap ~60) is what actually prevents multiple workers double-sending.
 *  - on/off + day/hour/timezone come entirely from env vars.
 */

interface JobConfig {
  name: string;
  enabled: boolean;
  day: number; // 0=Sun .. 6=Sat
  hour: number; // 0..23
  tz: string;
  run: () => Promise<unknown>;
}

const DAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function envOn(key: string, dflt = false): boolean {
  const v = process.env[key];
  if (v == null) return dflt;
  return ['on', 'true', '1', 'yes'].includes(v.trim().toLowerCase());
}

function envDay(key: string, dflt: string): number {
  const v = (process.env[key] ?? dflt).trim().toLowerCase().slice(0, 3);
  return DAYS[v] ?? DAYS[dflt];
}

function envHour(key: string, dflt: number): number {
  const n = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : dflt;
}

/** Day-of-week (0=Sun) and hour for "now" in the given IANA timezone. */
function nowInTz(tz: string): { day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const wk = parts.find((p) => p.type === 'weekday')?.value.toLowerCase().slice(0, 3) ?? 'sun';
  const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '0';
  // Intl may render midnight as "24"; normalize to 0.
  const hour = parseInt(hourRaw, 10) % 24;
  return { day: DAYS[wk] ?? 0, hour };
}

function jobs(): JobConfig[] {
  return [
    {
      name: 'project-reminders',
      enabled: envOn('PROJECT_REMINDER'),
      day: envDay('PROJECT_REMINDER_DAY', 'fri'),
      hour: envHour('PROJECT_REMINDER_HOUR', 8),
      tz: process.env.PROJECT_REMINDER_TZ || 'America/New_York',
      run: () => sendProjectReminders(60),
    },
    {
      name: 'completion-report',
      enabled: envOn('COMPLETION_REPORT'),
      day: envDay('COMPLETION_REPORT_DAY', 'mon'),
      hour: envHour('COMPLETION_REPORT_HOUR', 7),
      tz: process.env.COMPLETION_REPORT_TZ || 'America/New_York',
      run: () => sendCompletionReport(60),
    },
  ];
}

const g = globalThis as unknown as { __csEmailSched?: boolean };
// Tracks the last "YYYY-MM-DD-HH" a job fired, for in-process coalescing.
const lastFired = new Map<string, string>();

/** Start the scheduler exactly once per worker process. */
export function startEmailScheduler(): void {
  if (g.__csEmailSched) return;
  g.__csEmailSched = true;

  const active = jobs().filter((j) => j.enabled);
  if (active.length === 0) {
    console.log('[email] scheduler: no scheduled jobs enabled (set *_=on to enable).');
    return;
  }
  console.log(`[email] scheduler started for: ${active.map((j) => j.name).join(', ')}`);

  const tick = () => {
    for (const job of jobs()) {
      if (!job.enabled) continue;
      const { day, hour } = nowInTz(job.tz);
      if (day !== job.day || hour !== job.hour) continue;

      // Coalesce: fire at most once per matching hour in this process.
      const stamp = `${new Date().toISOString().slice(0, 10)}-${hour}`;
      if (lastFired.get(job.name) === stamp) continue;
      lastFired.set(job.name, stamp);

      Promise.resolve()
        .then(job.run)
        .then((res) => console.log(`[email] scheduled ${job.name}:`, res))
        .catch((err) => console.error(`[email] scheduled ${job.name} failed:`, err));
    }
  };

  // Check every minute. unref() so the timer never keeps the process alive.
  const timer = setInterval(tick, 60_000);
  if (typeof timer.unref === 'function') timer.unref();
}
