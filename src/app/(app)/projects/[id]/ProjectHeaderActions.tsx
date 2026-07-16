'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import type { Project } from '@/lib/types';
import { updateProjectDetailsAction, deleteProjectAction } from '@/app/actions/projects';

export function ProjectHeaderActions({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
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
          <div>
            <label className="label">Project Name</label>
            <input name="name" className="input" defaultValue={project.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Category</label>
              <input name="category" className="input" defaultValue={project.category ?? ''} />
            </div>
            <div>
              <label className="label">Contract Value</label>
              <input name="value" className="input" defaultValue={project.value} inputMode="decimal" />
            </div>
          </div>
          <div>
            <label className="label">Location</label>
            <input name="location" className="input" defaultValue={project.location ?? ''} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Start Date</label>
              <input name="start_date" type="date" className="input" defaultValue={project.start_date ?? ''} />
            </div>
            <div>
              <label className="label">Due Date</label>
              <input name="due_date" type="date" className="input" defaultValue={project.due_date ?? ''} />
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
    </div>
  );
}
