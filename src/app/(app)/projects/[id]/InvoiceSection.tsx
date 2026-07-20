'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';
import { updateInvoiceAction } from '@/app/actions/projects';

/**
 * Invoicing card with inline editing — no "Edit" modal required. The invoice
 * numbers and notes are editable in place; a Save/Cancel row appears only once
 * something changes. The Quote # links straight to the source quote when the
 * project came from one.
 */
export function InvoiceSection({ project }: { project: Project }) {
  const router = useRouter();
  const [numbers, setNumbers] = useState(project.invoice_numbers ?? '');
  const [notes, setNotes] = useState(project.invoice_notes ?? '');
  const [pending, start] = useTransition();
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Keep local state in sync if the project refreshes underneath us (e.g. after
  // a save elsewhere) as long as the user isn't mid-edit.
  const dirty =
    numbers !== (project.invoice_numbers ?? '') || notes !== (project.invoice_notes ?? '');
  useEffect(() => {
    if (!dirty) {
      setNumbers(project.invoice_numbers ?? '');
      setNotes(project.invoice_notes ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.invoice_numbers, project.invoice_notes]);

  // Auto-grow the notes textarea to fit its content.
  useEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [notes]);

  function save() {
    const fd = new FormData();
    fd.set('invoice_numbers', numbers);
    fd.set('invoice_notes', notes);
    start(async () => {
      await updateInvoiceAction(project.id, fd);
      router.refresh();
    });
  }

  function cancel() {
    setNumbers(project.invoice_numbers ?? '');
    setNotes(project.invoice_notes ?? '');
  }

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="brand-heading text-sm text-brand-gray">Invoicing</h2>
        {dirty && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-1 text-xs"
              onClick={cancel}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary px-3 py-1 text-xs"
              onClick={save}
              disabled={pending}
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
            Invoice Number(s)
          </label>
          <input
            className="input mt-1"
            value={numbers}
            onChange={(e) => setNumbers(e.target.value)}
            placeholder="e.g. INV-1042, INV-1043"
          />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Quote #</p>
          <p className="mt-1 text-sm text-brand-ink">
            {project.quote_number ? (
              project.quote_id ? (
                <Link
                  href={`/quotes/${project.quote_id}/edit`}
                  className="font-semibold text-brand-green-dark underline underline-offset-2 hover:text-brand-ink"
                >
                  {project.quote_number}
                </Link>
              ) : (
                project.quote_number
              )
            ) : (
              <span className="text-brand-gray">—</span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
          Invoice Notes
        </label>
        <textarea
          ref={notesRef}
          className="input mt-1 min-h-[70px] resize-y"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Billing terms, PO numbers, partial-invoice status…"
        />
      </div>
    </div>
  );
}
