'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { money } from '@/lib/format';
import type { Project } from '@/lib/types';
import { updateProjectDetailsAction, deleteProjectAction } from '@/app/actions/projects';
import { ContractValueControl } from '@/components/billing/ContractValueControl';

export function ProjectHeaderActions({
  project,
  canChangeValue,
}: {
  project: Project;
  /** Admins and managers only — the contract value is a billing number. */
  canChangeValue: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [valueOpen, setValueOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function save(fd: FormData) {
    setSaving(true);
    start(async () => {
      await updateProjectDetailsAction(project.id, fd);
      setSaving(false);
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    if (!confirm(`Delete "${project.name}"? This removes its notes and time entries too.`)) return;
    start(async () => {
      await deleteProjectAction(project.id);
    });
  }

  return (
    <div className="flex gap-2">
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        Edit
      </button>
      <button className="btn-danger" onClick={remove} disabled={pending}>
        Delete
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Edit Project">
        <form action={save} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Quote #</label>
              <input name="quote_number" className="input" defaultValue={project.quote_number ?? ''} placeholder="e.g. Q-2601" />
            </div>
            {/* Read-only here on purpose. What a job is worth used to be a text
                box on this form, so it could move with nothing recording that it
                had; changing it is a change order now, with a reason. */}
            <div>
              <label className="label">Contract Value</label>
              <div className="input tnum flex items-center justify-between gap-2 bg-surface-sunken">
                <span>{money(project.value, { cents: true })}</span>
                {canChangeValue && (
                  <button
                    type="button"
                    className="text-xs font-medium text-brand-gray hover:text-brand-ink hover:underline"
                    onClick={() => {
                      // Never a dialog inside a dialog — Modal owns the page's
                      // scroll lock, so two of them nested fight over it.
                      setOpen(false);
                      setValueOpen(true);
                    }}
                  >
                    Change…
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-brand-gray">
                {canChangeValue
                  ? 'A change order — recorded with the reason for it.'
                  : 'Only admins and managers can change what a job is worth.'}
              </p>
            </div>
          </div>
          <div>
            <label className="label">Project Name</label>
            <input name="name" className="input" defaultValue={project.name} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Category</label>
              <input name="category" className="input" defaultValue={project.category ?? ''} />
            </div>
            <div>
              <label className="label">Location</label>
              <input name="location" className="input" defaultValue={project.location ?? ''} />
            </div>
          </div>
          <div>
            <label className="label">Site Address</label>
            <input
              name="site_address"
              className="input"
              defaultValue={project.site_address ?? ''}
              placeholder="1420 Industrial Dr, Louisville, KY 40213"
            />
            <p className="mt-1 text-xs text-brand-gray">
              The address crews see on their schedule, with a directions link.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="label">Start Date</label>
              <input name="start_date" type="date" className="input" defaultValue={project.start_date ?? ''} />
            </div>
            <div>
              <label className="label">End Date</label>
              <input name="end_date" type="date" className="input" defaultValue={project.end_date ?? ''} />
            </div>
            <div>
              <label className="label">Due Date</label>
              <input name="due_date" type="date" className="input" defaultValue={project.due_date ?? ''} />
            </div>
            <div>
              <label className="label">Must Finish By</label>
              <input
                name="hard_finish_date"
                type="date"
                className="input"
                defaultValue={project.hard_finish_date ?? ''}
              />
              <p className="mt-1 text-xs text-brand-gray">Hard date — can&apos;t move.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* A sibling of the Edit modal, not a child of it: the Change… button
          closes Edit before opening this. */}
      <ContractValueControl
        projectId={project.id}
        projectName={project.name}
        open={valueOpen}
        onClose={() => setValueOpen(false)}
      />
    </div>
  );
}
