'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clockInAction, clockOutAction, switchJobAction } from '@/app/actions/time';
import { Modal } from '@/components/Modal';
import { duration } from '@/lib/format';
import { isValidSynopsis, SYNOPSIS_ERROR } from '@/lib/synopsis';
import { LUNCH_OPTIONS } from '@/lib/lunch';

interface ActiveInfo {
  id: number;
  projectId: number | null;
  projectName: string | null;
  customer: string | null;
  clockIn: string;
}

const GENERAL = 'general';

export function TimeClock({
  userName,
  active,
  projects,
  weekHours,
}: {
  userName: string;
  active: ActiveInfo | null;
  projects: { id: number; name: string; customer: string }[];
  weekHours: number;
}) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string>(GENERAL);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const router = useRouter();

  // Clock-out lunch prompt: 'ask' is the yes/no question, 'length' is the
  // follow-up asking how long the lunch was.
  const [lunchStep, setLunchStep] = useState<'ask' | 'length' | null>(null);
  const [lunchMinutes, setLunchMinutes] = useState<number>(LUNCH_OPTIONS[0].minutes);

  // The value of the job <select> shown while clocked in: the current job
  // stays selected by default, so "Switch job" is disabled until the worker
  // picks a different one.
  const currentJob = active ? (active.projectId === null ? GENERAL : String(active.projectId)) : GENERAL;
  const [switchTo, setSwitchTo] = useState<string>(currentJob);
  const [switchNote, setSwitchNote] = useState('');

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  // Re-anchor the switch selector whenever the active shift changes (after a
  // clock-in or a job switch), so it always defaults to the current job.
  useEffect(() => {
    setSwitchTo(currentJob);
  }, [active?.id, currentJob]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, fallback: string, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? fallback);
      else after?.();
      router.refresh();
    });
  }

  function clockIn() {
    const projectId = selected === GENERAL ? null : Number(selected);
    run(() => clockInAction(projectId), 'Could not clock in.');
  }

  /** Clocking out is a two-step flow: check the synopsis here, then ask about
   *  lunch in the modal before the shift is actually closed. */
  function askAboutLunch() {
    // Mirror the server-side rule: a real synopsis is required to clock out.
    if (!isValidSynopsis(note)) {
      setError(SYNOPSIS_ERROR);
      return;
    }
    setError(null);
    setLunchMinutes(LUNCH_OPTIONS[0].minutes);
    setLunchStep('ask');
  }

  function clockOut(minutes: number) {
    run(() => clockOutAction(note, minutes), 'Could not clock out.', () => {
      setNote('');
    });
    setLunchStep(null);
  }

  function switchJob() {
    const projectId = switchTo === GENERAL ? null : Number(switchTo);
    run(() => switchJobAction(projectId, switchNote), 'Could not switch jobs.', () => setSwitchNote(''));
  }

  return (
    <div className="card overflow-hidden">
      <div className="bg-brand-ink px-6 py-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/60">Signed in as</p>
            <p className="brand-heading text-xl">{userName}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-white/60">This week</p>
            <p className="text-xl font-bold text-brand-green">{weekHours.toFixed(1)}h</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        {active ? (
          <div>
            <div className="rounded-xl border border-brand-green/40 bg-brand-green/10 p-5 text-center">
              <p className="flex items-center justify-center gap-2 text-sm font-semibold text-brand-green-dark">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand-green" /> Clocked In
              </p>
              <p className="mt-3 text-4xl font-bold tabular-nums text-brand-ink">
                {duration(active.clockIn, null)}
              </p>
              <p className="mt-2 font-medium text-brand-ink">
                {active.projectName ?? 'General (no specific job)'}
              </p>
              {active.customer && <p className="text-sm text-brand-gray">{active.customer}</p>}
            </div>

            {/* Mid-day job switch: closes this segment and keeps the
                clock running on the new job. */}
            <div className="mt-5 border-t border-gray-100 pt-4">
              <label className="label">Switch to a different job</label>
              <select className="input" value={switchTo} onChange={(e) => setSwitchTo(e.target.value)}>
                <option value={GENERAL}>
                  General — no specific job{currentJob === GENERAL ? ' (current)' : ''}
                </option>
                {active.projectId !== null && !projects.some((p) => p.id === active.projectId) && (
                  <option value={String(active.projectId)}>
                    {active.customer ? `${active.customer} — ` : ''}
                    {active.projectName ?? 'Current job'} (current)
                  </option>
                )}
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.customer} — {p.name}
                    {String(p.id) === currentJob ? ' (current)' : ''}
                  </option>
                ))}
              </select>
              <input
                className="input mt-3"
                placeholder="What did you do on this job? (optional)"
                value={switchNote}
                onChange={(e) => setSwitchNote(e.target.value)}
              />
              <button
                className="mt-3 w-full rounded-lg border border-brand-green/50 bg-brand-green/10 py-3 text-base font-semibold text-brand-green-dark transition hover:bg-brand-green/20 disabled:opacity-50"
                onClick={switchJob}
                disabled={pending || switchTo === currentJob}
              >
                {pending ? '…' : 'Switch Job'}
              </button>
            </div>

            {/* Clock out — a shift synopsis is required, and the lunch prompt
                opens before the shift is closed. */}
            <div className="mt-5 border-t border-gray-100 pt-4">
              <label className="label">Shift synopsis — what did you work on? (required)</label>
              <input
                className="input"
                placeholder="e.g. Painted the back hallway and prepped trim"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button className="btn-primary mt-3 w-full py-3 text-base" onClick={askAboutLunch} disabled={pending}>
                {pending ? '…' : 'Clock Out'}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <label className="label">Choose a job (optional)</label>
            <select
              className="input"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value={GENERAL}>General — no specific job</option>
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.customer} — {p.name}
                </option>
              ))}
            </select>
            <button
              className="btn-primary mt-4 w-full py-3 text-base"
              onClick={clockIn}
              disabled={pending}
            >
              {pending ? '…' : 'Clock In'}
            </button>
          </div>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      <Modal
        open={lunchStep !== null}
        onClose={() => setLunchStep(null)}
        title={lunchStep === 'length' ? 'How long was your lunch?' : 'Lunch break'}
      >
        {lunchStep === 'length' ? (
          <div className="space-y-4">
            <p className="text-sm text-brand-gray">
              Pick how long you were on lunch. It comes off your shift total.
            </p>
            <div className="space-y-2">
              {LUNCH_OPTIONS.map((opt) => (
                <button
                  key={opt.minutes}
                  type="button"
                  onClick={() => setLunchMinutes(opt.minutes)}
                  className={`w-full rounded-lg border py-3 text-base font-semibold transition ${
                    lunchMinutes === opt.minutes
                      ? 'border-brand-green bg-brand-green/10 text-brand-green-dark'
                      : 'border-black/10 text-brand-ink hover:bg-black/[0.03]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                className="flex-1 rounded-lg border border-black/10 py-3 text-sm font-semibold text-brand-gray transition hover:bg-black/5 disabled:opacity-50"
                onClick={() => setLunchStep('ask')}
                disabled={pending}
              >
                Back
              </button>
              <button
                type="button"
                className="btn-primary flex-1 py-3 text-sm"
                onClick={() => clockOut(lunchMinutes)}
                disabled={pending}
              >
                {pending ? '…' : 'Clock Out'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-base font-medium text-brand-ink">Did you take a lunch break?</p>
            <p className="text-sm text-brand-gray">
              If you did, we&apos;ll subtract it from today&apos;s hours.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg border border-black/10 py-3 text-base font-semibold text-brand-ink transition hover:bg-black/[0.03] disabled:opacity-50"
                onClick={() => clockOut(0)}
                disabled={pending}
              >
                {pending ? '…' : 'No'}
              </button>
              <button
                type="button"
                className="btn-primary flex-1 py-3 text-base"
                onClick={() => setLunchStep('length')}
                disabled={pending}
              >
                Yes
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
