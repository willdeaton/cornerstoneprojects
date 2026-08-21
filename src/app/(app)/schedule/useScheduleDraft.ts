'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { applyDraft, type DraftEdit, type NewDraftEdit } from '@/lib/schedule-draft';
import { saveScheduleDraftAction } from '@/app/actions/schedule';
import type { ScheduleTaskRow } from '@/lib/types';

/** How often an untouched draft writes itself out. */
export const AUTOSAVE_MS = 10_000;

/** The working draft, as every schedule view sees it. */
export interface ScheduleDraft {
  /** The server's rows with every pending edit applied — what the views draw. */
  tasks: ScheduleTaskRow[];
  /** Edits made and not yet written. */
  edits: DraftEdit[];
  saving: boolean;
  /** When the last save finished, for the "Saved 2:41 PM" stamp. */
  savedAt: number | null;
  error: string | null;
  /** Add an edit to the draft. The board redraws immediately. */
  queue: (edit: NewDraftEdit) => void;
  /** A placeholder id for a phase that hasn't been saved yet. */
  newTaskId: () => number;
  /** Forget every queued edit for a phase that only exists in the draft. */
  dropTask: (taskId: number) => void;
  /** Write the draft now. True when everything in it landed. */
  save: () => Promise<boolean>;
  /** Throw the unsaved edits away and go back to what's in the database. */
  discard: () => void;
  clearError: () => void;
}

/**
 * The schedule's draft: edits collect here as they're made, the board redraws
 * from them at once, and they're written to the database every ten seconds (or
 * the moment somebody hits Save). Saving never emails anybody — that only
 * happens when the schedule is published.
 *
 * Two lists, not one. `edits` is what hasn't been written; `settling` is what
 * has just been written but whose refreshed rows haven't arrived from the
 * server yet. Both are applied, so a save doesn't make the board flicker back
 * to how it looked before the edit; `settling` is dropped as soon as new server
 * rows land (or after a moment, if a refresh went missing).
 *
 * A failed edit is reported and dropped rather than retried: a rejected edit
 * would otherwise fail again every ten seconds, and the refresh that follows
 * shows what really is in the database.
 */
export function useScheduleDraft(
  serverTasks: ScheduleTaskRow[],
  holidays: string[]
): ScheduleDraft {
  const router = useRouter();
  const [edits, setEdits] = useState<DraftEdit[]>([]);
  const [settling, setSettling] = useState<DraftEdit[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editsRef = useRef<DraftEdit[]>([]);
  const savingRef = useRef(false);
  const nextEditId = useRef(1);
  const nextTaskId = useRef(-1);
  editsRef.current = edits;

  // Fresh rows from the server include everything that was settling.
  useEffect(() => {
    setSettling([]);
  }, [serverTasks]);

  const tasks = useMemo(
    () => applyDraft(serverTasks, [...settling, ...edits], holidays),
    [serverTasks, settling, edits, holidays]
  );

  const queue = useCallback((edit: NewDraftEdit) => {
    setError(null);
    setEdits((prev) => [...prev, { ...edit, editId: nextEditId.current++ } as DraftEdit]);
  }, []);

  const newTaskId = useCallback(() => nextTaskId.current--, []);

  const dropTask = useCallback((taskId: number) => {
    setEdits((prev) => prev.filter((e) => e.taskId !== taskId));
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    const batch = editsRef.current;
    if (batch.length === 0) return true;

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await saveScheduleDraftAction(batch);
      const failed = new Set(res.failures.map((f) => f.editId));
      const done = batch
        .filter((e) => !failed.has(e.editId))
        // A phase saved for the first time now has a real id, so its
        // placeholder can stand down the moment the real row arrives.
        .map((e) =>
          e.kind === 'task-save' && res.ids[e.taskId]
            ? { ...e, savedId: res.ids[e.taskId] }
            : e
        );
      const batched = new Set(batch.map((e) => e.editId));
      setEdits((prev) => prev.filter((e) => !batched.has(e.editId)));
      setSettling((prev) => [...prev, ...done]);
      setSavedAt(Date.now());
      if (res.failures.length > 0) {
        setError(
          `${res.failures.length} ${res.failures.length === 1 ? 'change' : 'changes'} couldn't be saved: ` +
            res.failures.map((f) => `${f.label} — ${f.error}`).join(' · ')
        );
      }
      router.refresh();
      return res.failures.length === 0;
    } catch (err) {
      setError((err as Error).message || 'Could not save the schedule.');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [router]);

  const discard = useCallback(() => {
    setEdits([]);
    setError(null);
  }, []);

  // Autosave. The timer runs the whole time and does nothing when there's
  // nothing waiting, so a save is never more than ten seconds behind the work.
  useEffect(() => {
    const timer = setInterval(() => {
      if (editsRef.current.length > 0 && !savingRef.current) void save();
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, [save]);

  // Settling edits that never got their refresh shouldn't hang around forever.
  useEffect(() => {
    if (settling.length === 0) return;
    const timer = setTimeout(() => setSettling([]), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [settling]);

  // Closing the tab with edits in hand loses at most the last few seconds, but
  // it should still be a deliberate choice.
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (editsRef.current.length === 0) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return {
    tasks,
    edits,
    saving,
    savedAt,
    error,
    queue,
    newTaskId,
    dropTask,
    save,
    discard,
    clearError: () => setError(null),
  };
}
