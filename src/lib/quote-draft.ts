/*
 * ============================================================================
 *  QUOTE DRAFT
 *
 *  A quote is only ever written to the database when somebody presses Save.
 *  That is deliberate: `bid_value` is company-visible the moment it lands — it
 *  is the number on the quotes list, in the dashboard pipeline, and on the
 *  project a quote becomes when it sells — so an afternoon spent playing with
 *  a price must not leak out of the builder while it is still being played
 *  with.
 *
 *  What that costs is the work in the form. Close the tab, hit Back, or lose
 *  the browser, and an unsaved quote is gone. So the builder stashes what it
 *  is holding in this browser, on this machine, and offers it back the next
 *  time the same quote is opened. It is a recovery net, not a save: nothing
 *  here ever reaches the server, and a stashed draft changes nothing about
 *  the quote until the user restores it and saves it themselves.
 *
 *  Pure on purpose — no React, no database — so it can be reasoned about (and
 *  reused) on its own.
 * ============================================================================
 */

/** How long a stashed draft is kept before it is swept up as abandoned. */
export const QUOTE_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const PREFIX = 'cfs.quote-draft.';

/** The builder state we can put back, and what it was a draft *of*. */
export interface QuoteDraft {
  /** When the draft was stashed, for the "unsaved changes from 2:41 PM" line. */
  savedAt: number;
  /**
   * The quote's `updated_at` at the moment the draft was taken. If the stored
   * quote has moved on since, somebody else has saved it and this draft is
   * built on a version that no longer exists — see `isQuoteDraftUsable`.
   */
  baseUpdatedAt: string | null;
  /** The builder's own serialized form state — the same string it diffs on. */
  snapshot: string;
}

/** Where one quote's draft lives. A quote being created is keyed as 'new'. */
export function quoteDraftKey(quoteId: number | 'new'): string {
  return `${PREFIX}${quoteId}`;
}

/**
 * Read a stashed draft, or null if there isn't a usable one. Every failure
 * mode — no storage at all, private browsing, a half-written or hand-edited
 * value — is a null, never a throw: losing the recovery net is a nuisance, but
 * taking the quote builder down with it would be a great deal worse.
 */
export function readQuoteDraft(key: string): QuoteDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const d = parsed as Partial<QuoteDraft>;
    if (typeof d.snapshot !== 'string' || typeof d.savedAt !== 'number') return null;
    return {
      savedAt: d.savedAt,
      baseUpdatedAt: typeof d.baseUpdatedAt === 'string' ? d.baseUpdatedAt : null,
      snapshot: d.snapshot,
    };
  } catch {
    return null;
  }
}

/** Stash a draft. A storage that's full or unavailable is simply no net. */
export function writeQuoteDraft(key: string, draft: QuoteDraft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* no draft is better than a broken builder */
  }
}

export function clearQuoteDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to do — see above */
  }
}

/**
 * Is this draft still worth offering? Only when it actually differs from what
 * the form already shows, and only when the quote hasn't been saved by someone
 * else in the meantime: restoring on top of a colleague's newer save would put
 * their work back the way it was without either of them noticing.
 *
 * A quote being created has no `updated_at` on either side, so a 'new' draft is
 * judged on its contents alone.
 */
export function isQuoteDraftUsable(
  draft: QuoteDraft,
  currentSnapshot: string,
  currentUpdatedAt: string | null
): boolean {
  if (draft.snapshot === currentSnapshot) return false;
  return sameInstant(draft.baseUpdatedAt, currentUpdatedAt);
}

/**
 * Compare two timestamps as instants rather than strings — the same moment can
 * come back from the database differently formatted between requests.
 */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (isNaN(ta) || isNaN(tb)) return a === b;
  return ta === tb;
}

/**
 * Sweep up drafts nobody came back for. Without this, every quote ever abandoned
 * mid-edit keeps its snapshot in storage forever, and the one that finally
 * overflows the quota is somebody's live work.
 */
export function pruneQuoteDrafts(maxAgeMs: number = QUOTE_DRAFT_MAX_AGE_MS): void {
  try {
    const cutoff = Date.now() - maxAgeMs;
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const draft = readQuoteDraft(key);
      // An unreadable draft is no use to anybody either.
      if (!draft || draft.savedAt < cutoff) stale.push(key);
    }
    // Collected first, then removed: deleting mid-scan shifts the indexes.
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}
