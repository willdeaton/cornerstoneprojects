'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Note } from '@/lib/types';
import { dateTime } from '@/lib/format';
import { addNoteAction, deleteNoteAction } from '@/app/actions/projects';

export function NotesSection({
  projectId,
  notes,
  currentUserId,
}: {
  projectId: number;
  notes: Note[];
  currentUserId: number;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState('');
  const router = useRouter();

  function submit(fd: FormData) {
    start(async () => {
      await addNoteAction(projectId, fd);
      setValue('');
      formRef.current?.reset();
      router.refresh();
    });
  }

  function remove(noteId: number) {
    start(async () => {
      await deleteNoteAction(projectId, noteId);
      router.refresh();
    });
  }

  return (
    <div className="card p-5">
      <h2 className="brand-heading mb-4 text-sm text-brand-gray">
        Job Notes <span className="text-brand-gray/70">({notes.length})</span>
      </h2>

      <form ref={formRef} action={submit} className="mb-5">
        <textarea
          name="body"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input min-h-[80px] resize-y"
          placeholder="Add an update — delays, materials, customer requests, punch-list items…"
          required
        />
        <div className="mt-2 flex justify-end">
          <button type="submit" className="btn-primary" disabled={pending || !value.trim()}>
            {pending ? 'Posting…' : 'Post Note'}
          </button>
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="py-4 text-center text-sm text-brand-gray">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-black/5 bg-black/[0.015] p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold text-brand-ink">{n.author_name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-brand-gray">{dateTime(n.created_at)}</span>
                  {n.user_id === currentUserId && (
                    <button
                      onClick={() => remove(n.id)}
                      disabled={pending}
                      className="text-xs text-red-500 hover:underline"
                    >
                      delete
                    </button>
                  )}
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
