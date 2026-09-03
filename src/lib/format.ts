export function money(n: number, opts: { cents?: boolean } = {}): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(n || 0);
}

/** Compact currency for tight spaces, e.g. $187.2K */
export function moneyCompact(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n || 0);
}

/**
 * 'Aug 24, 2026'.
 *
 * A date-only string is a plain calendar date, so it's read and rendered in
 * UTC — that way it prints as itself no matter what timezone the renderer
 * happens to be in. A full timestamp is rendered in `timeZone` when one is
 * given (server-rendered documents pass the payroll timezone so they don't
 * drift with the container's clock) and in the local zone otherwise.
 */
export function shortDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  const dateOnly = !(iso.includes('T') || iso.includes(' '));
  const d = new Date(dateOnly ? iso + 'T00:00:00Z' : iso.replace(' ', 'T'));
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: dateOnly ? 'UTC' : timeZone,
  });
}

/**
 * 'Aug 25, 7:02 AM'. Rendered in `timeZone` when given, the local zone
 * otherwise — see the note on `clockTime` for why callers pass one.
 */
export function dateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  // SQLite datetime('now') is UTC without timezone marker; treat as UTC.
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });
}

/**
 * Clock time only, e.g. "7:02 AM" — for a column whose day is already known.
 *
 * `timeZone` matters here: a timestamp with no zone given renders in whatever
 * zone the code is running in, which for a client component is the viewer's
 * browser but for a server-rendered document is the container's clock (UTC on
 * every host we deploy to). A printed timesheet has to agree with the screen,
 * so anything rendered on the server passes the payroll timezone explicitly.
 */
export function clockTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
}

/** Duration between two ISO timestamps (or now if end is null) as "3h 42m". */
export function duration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso.includes('T') ? startIso : startIso.replace(' ', 'T') + 'Z');
  const end = endIso
    ? new Date(endIso.includes('T') ? endIso : endIso.replace(' ', 'T') + 'Z')
    : new Date();
  let mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  mins = mins % 60;
  if (h === 0) return `${mins}m`;
  return `${h}h ${mins}m`;
}

/** Total hours (decimal) between two timestamps. */
export function hoursBetween(startIso: string, endIso: string | null): number {
  const start = new Date(startIso.includes('T') ? startIso : startIso.replace(' ', 'T') + 'Z');
  const end = endIso
    ? new Date(endIso.includes('T') ? endIso : endIso.replace(' ', 'T') + 'Z')
    : new Date();
  return Math.max(0, (end.getTime() - start.getTime()) / 3600000);
}
