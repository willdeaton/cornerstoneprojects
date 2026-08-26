'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearQuoteDraft,
  isQuoteDraftUsable,
  pruneQuoteDrafts,
  quoteDraftKey,
  readQuoteDraft,
  writeQuoteDraft,
  type QuoteDraft,
} from '@/lib/quote-draft';

/** How long the typing has to stop before the draft is stashed. */
const STASH_MS = 2_000;

export interface QuoteDraftState {
  /** A draft worth offering back, or null. Rendered as the restore bar. */
  offered: QuoteDraft | null;
  /** Take the offered draft — returns its snapshot for the builder to apply. */
  restore: () => string | null;
  /** Throw the offered draft away. */
  dismiss: () => void;
  /** Forget the stash entirely — after a save, or a deliberate discard. */
  clear: () => void;
}

/**
 * The builder's recovery net. While there are unsaved edits it stashes the
 * form's own snapshot string in this browser a couple of seconds after typing
 * stops, and warns before the tab closes; when the builder is next opened on
 * the same quote it offers the stash back.
 *
 * It never talks to the server — see `src/lib/quote-draft.ts` for why. The
 * builder stays the single source of truth for the form: this hook only holds
 * a copy and hands it back when asked.
 */
export function useQuoteDraft({
  quoteId,
  snapshot,
  dirty,
  updatedAt,
}: {
  /** The quote being edited, or 'new' for one that doesn't exist yet. */
  quoteId: number | 'new';
  /** The builder's serialized form state — the string it already diffs on. */
  snapshot: string;
  /** Whether that snapshot differs from the last save. */
  dirty: boolean;
  /** The stored quote's `updated_at`, to spot a colleague's newer save. */
  updatedAt: string | null;
}): QuoteDraftState {
  const key = quoteDraftKey(quoteId);
  const [offered, setOffered] = useState<QuoteDraft | null>(null);

  // The current values, for handlers that must not be rebuilt on every
  // keystroke (the unload guard) or that fire on a timer.
  const snapshotRef = useRef(snapshot);
  const dirtyRef = useRef(dirty);
  const updatedAtRef = useRef(updatedAt);
  snapshotRef.current = snapshot;
  dirtyRef.current = dirty;
  updatedAtRef.current = updatedAt;

  // Look for a draft once per quote, against the form as it first loaded —
  // hence the deliberately narrow dependency list. Re-running this as the user
  // types would keep re-offering a draft they have already dismissed.
  useEffect(() => {
    pruneQuoteDrafts();
    const draft = readQuoteDraft(key);
    if (!draft) return;
    if (!isQuoteDraftUsable(draft, snapshotRef.current, updatedAtRef.current)) {
      // Built on a version of the quote that no longer exists, or holding
      // nothing the form isn't already showing. Either way it is spent.
      clearQuoteDraft(key);
      return;
    }
    setOffered(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Stash the edits a moment after they stop. Debounced rather than on every
  // keystroke so a long description doesn't serialize the whole form per letter.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      writeQuoteDraft(key, {
        savedAt: Date.now(),
        baseUpdatedAt: updatedAtRef.current,
        snapshot: snapshotRef.current,
      });
    }, STASH_MS);
    return () => clearTimeout(timer);
  }, [key, snapshot, dirty]);

  // Leaving with unsaved edits loses at most the last couple of seconds, and
  // the draft will be waiting on the way back in — but it should still be a
  // deliberate choice.
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const clear = useCallback(() => {
    clearQuoteDraft(key);
    setOffered(null);
  }, [key]);

  const restore = useCallback(() => {
    const snap = offered?.snapshot ?? null;
    // The draft has served its purpose the moment it's back in the form; from
    // here the edits are live again and get stashed like any others.
    clearQuoteDraft(key);
    setOffered(null);
    return snap;
  }, [key, offered]);

  return { offered, restore, dismiss: clear, clear };
}
