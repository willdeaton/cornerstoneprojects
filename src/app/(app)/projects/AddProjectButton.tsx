'use client';

import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { createProjectAction } from '@/app/actions/projects';

export function AddProjectButton() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + Add Project
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add Project">
        <form
          action={async (fd) => {
            setSaving(true);
            await createProjectAction(fd);
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Customer *</label>
              <input name="customer" className="input" required />
            </div>
            <div>
              <label className="label">Category</label>
              <input name="category" className="input" placeholder="Flooring" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Project Name *</label>
              <input name="name" className="input" required placeholder="Scope of work" />
            </div>
            <div>
              <label className="label">Quote #</label>
              <input name="quote_number" className="input" placeholder="e.g. Q-2601" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Contract Value</label>
              <input name="value" className="input" inputMode="decimal" placeholder="25000" />
            </div>
            <div>
              <label className="label">Status</label>
              <select name="status" className="input" defaultValue="not_started">
                <option value="not_started">Not Started</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Location</label>
            <input name="location" className="input" placeholder="City, KY" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="label">Start Date</label>
              <input name="start_date" type="date" className="input" />
            </div>
            <div>
              <label className="label">End Date</label>
              <input name="end_date" type="date" className="input" />
            </div>
            <div>
              <label className="label">Due Date</label>
              <input name="due_date" type="date" className="input" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
