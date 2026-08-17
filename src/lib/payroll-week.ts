import 'server-only';

/*
 * Payroll-week date math, done in the payroll timezone (PAYROLL_TZ, default
 * America/Chicago) so "Monday morning" means Monday for the crews — not UTC.
 * Weeks are Monday-start, matching date_trunc('week', ...) in the data layer.
 */

const DAY_MS = 864e5;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function payrollTimeZone(): string {
  return process.env.PAYROLL_TZ ?? 'America/Chicago';
}

/** The current weekday ('Mon'..'Sun'), hour (0-23) and date in the payroll TZ. */
export function zonedNow(now: Date = new Date(), tz: string = payrollTimeZone()): {
  weekday: string;
  hour: number;
  year: number;
  month: number;
  day: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  return {
    weekday: parts.weekday,
    hour: parseInt(parts.hour, 10) % 24,
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
  };
}

/** Monday (YYYY-MM-DD) of the week BEFORE the current one, in the payroll TZ. */
export function priorWeekStart(now: Date = new Date(), tz: string = payrollTimeZone()): string {
  const z = zonedNow(now, tz);
  const dow = Math.max(0, DOW.indexOf(z.weekday as (typeof DOW)[number]));
  // Anchor the zoned calendar date at UTC midnight for safe day arithmetic.
  const todayUtc = Date.UTC(z.year, z.month - 1, z.day);
  const mondayThisWeek = todayUtc - dow * DAY_MS;
  return new Date(mondayThisWeek - 7 * DAY_MS).toISOString().slice(0, 10);
}
