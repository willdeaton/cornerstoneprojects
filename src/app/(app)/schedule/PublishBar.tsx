'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { dateTime } from '@/lib/format';
import {
  publishScheduleAction,
  unpublishScheduleAction,
  getScheduleHistoryAction,
} from '@/app/actions/schedule';
import type { ScheduleChange } from '@/lib/types';
import type { PublishResult } from '@/app/actions/schedule';

/** What the board knows about a job's published schedule. */
export interface PublishedInfo {
  version: number;
  published_at: string;
  published_by_name?: string | null;
  /** How many changes have been logged against the job, published or not. */
  changeCount?: number;
}

/**
 * Publish state for one job, as a badge plus the actions around it.
 *
 * Publishing is how the crew is told: it emails everyone booked on this job
 * their own days and records the dates as the version they're working to. From
 * then on the phase editor requires a reason for anything that moves work or
 * people, not just for the dates, which always need one. Either way the reasons
 * are readable here — the change history opens whether or not the job has been
 * published.
 */
export function PublishBar({
  projectId,
  projectName,
  published,
  changeCount = 0,
  canUnpublish = false,
  compact = true,
}: {
  projectId: number;
  projectName: string;
  published: PublishedInfo | null;
  /**
   * Logged changes for this job. Read from `published` when it's set; passed
   * separately so an unpublished job can still show its history — dates that
   * move are recorded from the first plan onwards.
   */
  changeCount?: number;
  canUnpublish?: boolean;
  /** Compact renders inside the timeline's job header; false is roomier. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [note, setNote] = useState('');
  const [includeSubs, setIncludeSubs] = useState(true);
  const [sent, setSent] = useState<PublishResult | null>(null);
  const [history, setHistory] = useState<ScheduleChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    setError(null);
    setBusy(true);
    const res = await publishScheduleAction([projectId], { note, includeSubs });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not publish.');
      return;
    }
    setSent(res);
    setNote('');
    router.refresh();
  }

  async function unpublish() {
    if (
      !confirm(
        `Un-publish the schedule for "${projectName}"? Crew and start-time changes will stop asking for a reason — moving dates still will.`
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await unpublishScheduleAction(projectId);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Could not un-publish.');
    else router.refresh();
  }

  async function openHistory() {
    setBusy(true);
    setHistory(await getScheduleHistoryAction(projectId));
    setBusy(false);
  }

  const text = compact ? 'text-[11px]' : 'text-xs';
  const changes = published?.changeCount ?? changeCount;

  return (
    <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 ${text}`}>
      {published ? (
        <>
          <span
            className="rounded bg-brand-green/15 px-1.5 py-0.5 font-semibold text-brand-green-dark"
            title={`Published ${dateTime(published.published_at)}${
              published.published_by_name ? ` by ${published.published_by_name}` : ''
            }`}
          >
            Published v{published.version}
          </span>
          <button
            className="font-medium text-brand-gray hover:text-brand-ink hover:underline"
            onClick={openHistory}
            disabled={busy}
          >
            {changes ? `${changes} change${changes === 1 ? '' : 's'}` : 'Changes'}
          </button>
          <button
            className="font-medium text-brand-gray hover:text-brand-ink hover:underline"
            onClick={() => setPublishing(true)}
            disabled={busy}
            title="Re-send the current dates to everyone booked, as a new version"
          >
            Re-publish
          </button>
          {canUnpublish && (
            <button
              className="font-medium text-brand-gray hover:text-red-700 hover:underline"
              onClick={unpublish}
              disabled={busy}
            >
              Un-publish
            </button>
          )}
        </>
      ) : (
        <>
          <button
            className="font-medium text-brand-green-dark hover:underline"
            onClick={() => setPublishing(true)}
            disabled={busy}
            title="Email these dates to everyone booked on the job — crew and start-time changes will need a reason afterwards"
          >
            Publish schedule
          </button>
          <button
            className="font-medium text-brand-gray hover:text-brand-ink hover:underline"
            onClick={openHistory}
            disabled={busy}
            title="Every change to this job's dates, and the reason given"
          >
            {changes ? `${changes} change${changes === 1 ? '' : 's'}` : 'Changes'}
          </button>
        </>
      )}

      {error && <span className="text-red-700">{error}</span>}

      {publishing && (
        <Modal
          open
          onClose={() => {
            setPublishing(false);
            setSent(null);
          }}
          title={
            sent
              ? `Published: ${projectName}`
              : published
                ? `Re-publish: ${projectName}`
                : `Publish: ${projectName}`
          }
        >
          {sent ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-brand-green/10 px-3 py-2 text-sm text-brand-ink">
                <p className="font-semibold">
                  {sent.published[0]
                    ? `Now published as v${sent.published[0].version}.`
                    : 'Published.'}
                </p>
                <p className="text-brand-gray">
                  {sent.email && sent.email.count > 0
                    ? `Emailed ${sent.email.count} of ${sent.email.attempted} people their own dates.`
                    : (sent.email?.reason ?? 'There was nobody to email.')}
                </p>
              </div>
              {!!sent.email?.skipped.length && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-semibold">Not emailed</p>
                  <ul className="mt-1 space-y-0.5">
                    {sent.email.skipped.map((s) => (
                      <li key={`${s.name}-${s.reason}`}>
                        {s.name} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end">
                <button
                  className="btn-primary"
                  onClick={() => {
                    setPublishing(false);
                    setSent(null);
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-brand-gray">
                {published
                  ? `Everyone booked on this job is emailed their own dates again, and the current plan becomes version ${published.version + 1} — the baseline the crew is working to. Changes after it still need a reason.`
                  : 'Everyone booked on this job is emailed their own dates, and this plan becomes the one the crew is working to. Moving dates already needs a reason; from now on so does changing crew, start times or phase notes, and every reason is kept in the change history.'}
              </p>
              <label className="flex items-center gap-2 text-sm text-brand-ink">
                <input
                  type="checkbox"
                  checked={includeSubs}
                  onChange={(e) => setIncludeSubs(e.target.checked)}
                />
                Also email subcontractors with an address on file
              </label>
              <div>
                <label className="label">Note (optional)</label>
                <input
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Sent to crew after the pre-con walk"
                />
              </div>
              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  className="btn-secondary"
                  onClick={() => setPublishing(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button className="btn-primary" onClick={publish} disabled={busy}>
                  {busy ? 'Publishing…' : published ? 'Re-publish & send' : 'Publish & send'}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {history && (
        <Modal open onClose={() => setHistory(null)} title={`Schedule changes: ${projectName}`} wide>
          <ScheduleHistory changes={history} />
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" onClick={() => setHistory(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const KIND_LABEL: Record<ScheduleChange['kind'], string> = {
  added: 'Phase added',
  updated: 'Phase changed',
  deleted: 'Phase removed',
  job: 'Job dates',
};

const KIND_BADGE: Record<ScheduleChange['kind'], string> = {
  added: 'bg-brand-green/15 text-brand-green-dark',
  updated: 'bg-amber-100 text-amber-800',
  deleted: 'bg-red-100 text-red-700',
  job: 'bg-blue-100 text-blue-800',
};

/**
 * The logged reasons for one job, newest first — every move of the dates,
 * whether or not the schedule had been published when it happened.
 */
export function ScheduleHistory({ changes }: { changes: ScheduleChange[] }) {
  if (changes.length === 0) {
    return (
      <p className="text-sm text-brand-gray">
        Nothing has moved yet. Every change to this job&apos;s dates is recorded here with the
        reason it was given.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-black/5">
      {changes.map((c) => (
        <li key={c.id} className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge ${KIND_BADGE[c.kind]}`}>{KIND_LABEL[c.kind]}</span>
            <span className="font-medium text-brand-ink">
              {c.kind === 'job' ? 'This job' : c.task_name ?? 'A phase'}
            </span>
            <span className="text-xs text-brand-gray">
              {dateTime(c.created_at)}
              {c.changed_by_name ? ` · ${c.changed_by_name}` : ''}
              {c.version ? ` · after v${c.version}` : ' · before publishing'}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-brand-ink">{c.reason}</p>
          <p className="mt-0.5 text-sm text-brand-gray">{c.summary}</p>
        </li>
      ))}
    </ul>
  );
}
