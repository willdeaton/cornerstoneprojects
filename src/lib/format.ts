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

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') || iso.includes(' ') ? iso : iso + 'T00:00:00');
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  // SQLite datetime('now') is UTC without timezone marker; treat as UTC.
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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
