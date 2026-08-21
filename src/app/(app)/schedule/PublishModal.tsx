'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { dateTime, shortDate } from '@/lib/format';
import { assigneeBookings, computeSchedule, today } from '@/lib/schedule-math';
import { publishScheduleAction, type PublishResult } from '@/app/actions/schedule';
import type { ScheduleDraft } from './useScheduleDraft';

/** A job with changes the crew hasn't been sent, as the bar receives it. */
export interface DraftJob {
  project_id: number;
  project_name: string;
  customer: string;
  changed_at: string;
  changed_by_name: string | null;
  /** The version the crew already has, or null if it's never gone out. */
  version: number | null;
}

/**
 * Publishing, with the consequences on screen first: which jobs are about to be
 * baselined, and exactly who gets an email about them.
 *
 * The draft is written before anything is sent. Publishing a job whose latest
 * edits are still sitting in the browser would email dates nobody has agreed to,
 * so a draft that won't save stops the publish.
 */
export function PublishModal({
  draft,
  drafts,
  holidays,
  onClose,
}: {
  draft: ScheduleDraft;
  drafts: DraftJob[];
  /** Non-working days, so the windows here match the ones the email uses. */
  holidays: string[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<number[]>(() => drafts.map((d) => d.project_id));
  const [includeSubs, setIncludeSubs] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);

  const chosen = useMemo(() => new Set(picked), [picked]);

  /**
   * Who the send will reach, worked out from the same bookings the email is
   * built from — everyone still to work on the picked jobs, from today on.
   * Days already worked aren't news, so they don't pull anybody in.
   */
  const recipients = useMemo(() => {
    const now = today();
    const calendar = { holidays: new Set(holidays) };
    const { windows } = computeSchedule(draft.tasks, calendar);
    const seen = new Map<string, { name: string; kind: 'user' | 'sub'; days: number }>();
    for (const b of assigneeBookings(draft.tasks, windows, calendar)) {
      if (!chosen.has(b.projectId) || b.end < now) continue;
      if (!includeSubs && b.kind === 'sub') continue;
      const entry = seen.get(b.key) ?? { name: b.name, kind: b.kind, days: 0 };
      entry.days++;
      seen.set(b.key, entry);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [draft.tasks, chosen, includeSubs, holidays]);

  function toggle(projectId: number) {
    setPicked((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]
    );
  }

  async function publish() {
    setError(null);
    setBusy(true);
    // Everything on the board has to be in the database before the crew is told
    // it's their schedule.
    if (draft.edits.length > 0 && !(await draft.save())) {
      setBusy(false);
      setError('Your latest changes could not be saved, so nothing was published or sent.');
      return;
    }
    const res = await publishScheduleAction(picked, { note, includeSubs });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not publish.');
      return;
    }
    setResult(res);
  }

  if (result) {
    const email = result.email;
    return (
      <Modal open onClose={onClose} title="Published" wide>
        <div className="space-y-4">
          <div className="rounded-lg bg-brand-green/10 px-3 py-2 text-sm text-brand-ink">
            <p className="font-semibold">
              {email && email.count > 0
                ? `Sent to ${email.count} of ${email.attempted}.`
                : 'Nothing to send.'}
            </p>
            {email?.reason && <p className="text-brand-gray">{email.reason}</p>}
            {email?.range && (
              <p className="text-brand-gray">
                Covering {shortDate(email.range.from)} – {shortDate(email.range.to)}
              </p>
            )}
          </div>
          <ul className="divide-y divide-black/5 text-sm">
            {result.published.map((p) => (
              <li key={p.project_id} className="flex justify-between py-2">
                <span className="font-medium text-brand-ink">{p.project_name}</span>
                <span className="text-brand-gray">now v{p.version}</span>
              </li>
            ))}
          </ul>
          {!!email?.skipped.length && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-semibold">Not emailed</p>
              <ul className="mt-1 space-y-0.5">
                {email.skipped.map((s) => (
                  <li key={`${s.name}-${s.reason}`}>
                    {s.name} — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-brand-gray">
            Changes to these jobs now need a reason, and each one comes back to the unsent list as
            soon as its dates move again.
          </p>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Publish & Send Schedule" wide>
      <div className="space-y-4">
        <p className="text-sm text-brand-gray">
          Publishing is what tells people. Each job below is baselined as the version its crew is
          working to, and everyone booked on it gets one email listing only their own days.
        </p>

        {drafts.length === 0 ? (
          <p className="rounded-lg border border-black/10 bg-black/[.02] px-3 py-2 text-sm text-brand-ink">
            Nothing has changed since the last time these jobs were published. Publish a job again
            from its row on the timeline if you need to re-send its dates.
          </p>
        ) : (
          <div className="rounded-lg border border-black/10">
            <p className="border-b border-black/5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">
              Jobs with changes the crew hasn&apos;t been sent
            </p>
            <ul className="divide-y divide-black/5">
              {drafts.map((d) => (
                <li key={d.project_id}>
                  <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm hover:bg-black/[.02]">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={chosen.has(d.project_id)}
                      onChange={() => toggle(d.project_id)}
                    />
                    <span>
                      <span className="font-medium text-brand-ink">{d.project_name}</span>
                      <span className="text-brand-gray"> · {d.customer}</span>
                      <span className="block text-xs text-brand-gray">
                        {d.version == null
                          ? 'Never published — this will be v1'
                          : `Published v${d.version} — this will be v${d.version + 1}`}
                        {' · changed '}
                        {dateTime(d.changed_at)}
                        {d.changed_by_name ? ` by ${d.changed_by_name}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="flex items-start gap-2 text-sm text-brand-ink">
          <input
            type="checkbox"
            className="mt-1"
            checked={includeSubs}
            onChange={(e) => setIncludeSubs(e.target.checked)}
          />
          <span>
            Also email subcontractors
            <span className="block text-xs text-brand-gray">
              Only the ones with an address on file; the rest are listed as skipped.
            </span>
          </span>
        </label>

        <div className="rounded-lg border border-black/10 bg-black/[.02] px-3 py-2 text-sm">
          <p className="font-semibold text-brand-ink">
            {recipients.length === 0
              ? 'Nobody is booked on this work yet'
              : `${recipients.length} ${recipients.length === 1 ? 'person' : 'people'} will be emailed`}
          </p>
          {recipients.length > 0 && (
            <p className="mt-0.5 text-brand-gray">
              {recipients.map((r) => r.name + (r.kind === 'sub' ? ' (sub)' : '')).join(', ')}
            </p>
          )}
          {recipients.length === 0 && picked.length > 0 && (
            <p className="mt-0.5 text-brand-gray">
              The dates are still baselined, so later changes to them ask for a reason.
            </p>
          )}
        </div>

        <div>
          <label className="label">Note (optional)</label>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Sent to crew after the pre-con walk"
          />
          <p className="mt-1 text-xs text-brand-gray">
            Kept with the published version, alongside who published it.
          </p>
        </div>

        {draft.edits.length > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {draft.edits.length} unsaved {draft.edits.length === 1 ? 'change' : 'changes'} will be
            saved first — the crew is only ever sent what&apos;s in the database.
          </p>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={publish} disabled={busy || picked.length === 0}>
            {busy ? 'Publishing…' : `Publish & send${picked.length > 1 ? ` (${picked.length} jobs)` : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
