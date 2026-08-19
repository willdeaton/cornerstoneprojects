'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CrewNote } from '@/lib/types';
import { dateTime } from '@/lib/format';
import { saveCrewNoteAction, deleteCrewNoteAction } from '@/app/actions/schedule';

/**
 * Job-specific messages for the people working the job: gate codes, parking, who
 * to ask for on site, what to bring.
 *
 * Deliberately not the same list as Job Notes — those are the internal record of
 * how a job is going, while these are written to be read by the crew. Everyone
 * booked on the job sees them on their own schedule and in the schedule email,
 * so "important" pins one to the top of that list.
 */
export function CrewNotesSection({
  projectId,
  notes,
}: {
  projectId: number;
  notes: CrewNote[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function post() {
    setError(null);
    start(async () => {
      const res = await saveCrewNoteAction({ project_id: projectId, body, pinned });
      if (!res.ok) {
        setError(res.error ?? 'Could not post that note.');
        return;
      }
      setBody('');
      setPinned(false);
      router.refresh();
    });
  }

  function togglePin(note: CrewNote) {
    start(async () => {
      await saveCrewNoteAction({
        id: note.id,
        project_id: projectId,
        body: note.body,
        pinned: !note.pinned,
      });
      router.refresh();
    });
  }

  function remove(id: number) {
    if (!confirm('Delete this crew note? It will disappear from their schedules.')) return;
    start(async () => {
      await deleteCrewNoteAction(id);
      router.refresh();
    });
  }

  return (
    <div className="card p-5">
      <h2 className="brand-heading mb-1 text-sm text-brand-gray">
        Crew Notes <span className="text-brand-gray/70">({notes.length})</span>
      </h2>
      <p className="mb-4 text-xs text-brand-gray">
        Read by everyone scheduled on this job — on their own schedule and in the schedule email.
      </p>

      <div className="mb-5">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="input min-h-[80px] resize-y"
          placeholder="Gate code 4471, park on the north side, ask for Mike at the trailer…"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-brand-ink">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            Mark important (stays at the top)
          </label>
          <button
            type="button"
            className="btn-primary"
            onClick={post}
            disabled={pending || !body.trim()}
          >
            {pending ? 'Posting…' : 'Post For Crew'}
          </button>
        </div>
        {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      {notes.length === 0 ? (
        <p className="py-4 text-center text-sm text-brand-gray">
          Nothing for the crew yet on this job.
        </p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li
              key={n.id}
              className={`rounded-lg border p-3 ${
                n.pinned
                  ? 'border-brand-green/40 bg-brand-green/5'
                  : 'border-black/5 bg-black/[0.015]'
              }`}
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-brand-ink">
                  {n.pinned && <span className="mr-1 text-brand-green-dark">Important ·</span>}
                  {n.author_name}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-brand-gray">{dateTime(n.created_at)}</span>
                  <button
                    onClick={() => togglePin(n)}
                    disabled={pending}
                    className="text-xs font-medium text-brand-green-dark hover:underline"
                  >
                    {n.pinned ? 'unpin' : 'pin'}
                  </button>
                  <button
                    onClick={() => remove(n.id)}
                    disabled={pending}
                    className="text-xs text-red-500 hover:underline"
                  >
                    delete
                  </button>
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-brand-ink/90">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
