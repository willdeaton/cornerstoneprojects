'use client';

import { useState } from 'react';
import { AUTOSAVE_MS, type ScheduleDraft } from './useScheduleDraft';
import { PublishModal, type DraftJob } from './PublishModal';

/**
 * The two things that happen to a schedule, side by side above both views.
 *
 * SAVE keeps the work. Edits are written every ten seconds anyway, and Save
 * writes them now; either way nobody is told anything, so a week can be
 * planned, re-planned and left half-done without a single email going out.
 *
 * PUBLISH tells the crew. It baselines the dates as the version they're working
 * to and emails everyone booked on those jobs their own days — the only
 * schedule email the app sends. The bar keeps count of the jobs whose dates
 * have moved since they were last published, so what's outstanding is on
 * screen rather than in somebody's head.
 */
export function ScheduleSaveBar({
  draft,
  drafts,
  holidays,
  canPublish,
}: {
  draft: ScheduleDraft;
  /** Jobs with changes the crew hasn't been sent, from the server. */
  drafts: DraftJob[];
  holidays: string[];
  canPublish: boolean;
}) {
  const [publishing, setPublishing] = useState(false);
  const pending = draft.edits.length;
  const unsent = drafts.length;

  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-brand-ink">
          {draft.saving ? (
            <span className="text-brand-gray">Saving…</span>
          ) : pending > 0 ? (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
              {pending} unsaved {pending === 1 ? 'change' : 'changes'}
              <span className="font-normal text-brand-gray">
                · saves itself every {Math.round(AUTOSAVE_MS / 1000)} seconds
              </span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand-green" aria-hidden />
              {draft.savedAt ? `Saved ${clockTime(draft.savedAt)}` : 'Nothing unsaved'}
            </>
          )}
        </p>
        <p className="mt-0.5 text-xs text-brand-gray">
          {unsent === 0
            ? 'Every job’s crew has the dates that are on the board. Saving never emails anyone — publishing does.'
            : `${unsent} ${unsent === 1 ? 'job has changes' : 'jobs have changes'} the crew hasn’t been sent: ${drafts
                .map((d) => d.project_name)
                .join(', ')}`}
        </p>
        {draft.error && (
          <p className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{draft.error}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {pending > 0 && !draft.saving && (
          <button
            className="text-xs font-medium text-brand-gray hover:text-red-700 hover:underline"
            onClick={() => {
              if (confirm(`Throw away ${pending} unsaved ${pending === 1 ? 'change' : 'changes'}?`)) {
                draft.discard();
              }
            }}
          >
            Discard
          </button>
        )}
        <button
          className="btn-secondary"
          onClick={() => void draft.save()}
          disabled={draft.saving || pending === 0}
          title={pending === 0 ? 'Everything is already saved' : 'Write these changes now'}
        >
          {draft.saving ? 'Saving…' : 'Save'}
        </button>
        {canPublish && (
          <button
            className="btn-primary"
            onClick={() => setPublishing(true)}
            title="Baseline these dates and email the crews booked on them"
          >
            Publish &amp; Send
          </button>
        )}
      </div>

      {publishing && (
        <PublishModal
          draft={draft}
          drafts={drafts}
          holidays={holidays}
          onClose={() => setPublishing(false)}
        />
      )}
    </div>
  );
}

/** "2:41 PM" — the stamp on the last save. */
function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
