/**
 * Remembering where a list was left off.
 *
 * The Quotes and Projects lists keep their tab in the URL and everything else
 * — search text, category, sort, how far down the page you were — in the
 * client. Opening a row and coming back would otherwise dump you at the top of
 * the default tab, so both halves get parked in sessionStorage: the exact list
 * URL for the "← Back" links, and the filters plus scroll offset for the list
 * itself to pick up again.
 *
 * sessionStorage rather than localStorage on purpose — this is "where I just
 * was", per browser tab, and shouldn't outlive the session.
 */

const PREFIX = 'cornerstone:list:';

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    // Some privacy modes throw on access. Remembering state is a nicety.
    return null;
  }
}

function read<T>(key: string): T | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota or a locked-down browser — nothing worth failing a click over.
  }
}

/** The filter/sort state a list wants back when the user returns to it. */
export function readListFilters<T>(listKey: string): Partial<T> | null {
  const saved = read<Partial<T>>(`${listKey}:filters`);
  return saved && typeof saved === 'object' ? saved : null;
}

export function writeListFilters<T>(listKey: string, filters: T): void {
  write(`${listKey}:filters`, filters);
}

/** The exact list URL — tab included — that a detail page should return to. */
export function rememberListHref(listKey: string, href: string): void {
  write(`${listKey}:href`, href);
}

export function readListHref(listKey: string): string | null {
  const href = read<string>(`${listKey}:href`);
  return typeof href === 'string' ? href : null;
}

/** Scroll offsets are per list URL — the Lost tab is a different page. */
export function readListScroll(listKey: string, href: string): number | null {
  const y = read<number>(`${listKey}:scroll:${href}`);
  return typeof y === 'number' && Number.isFinite(y) && y > 0 ? y : null;
}

export function writeListScroll(listKey: string, href: string, y: number): void {
  write(`${listKey}:scroll:${href}`, Math.max(0, Math.round(y)));
}

/**
 * Vet a remembered href before navigating to it: it has to be a plain path
 * under the list it came from, with nothing but a query string after it. Also
 * runs on the server, where a save-and-close redirect has to trust a path the
 * client handed it.
 */
export function safeListHref(href: string | null | undefined, base: string): string {
  if (!href || !href.startsWith(base)) return base;
  const rest = href.slice(base.length);
  // No scheme, host, or deeper path — `/quotes?status=lost`, not `/quotes/7`.
  return rest === '' || rest.startsWith('?') ? href : base;
}
