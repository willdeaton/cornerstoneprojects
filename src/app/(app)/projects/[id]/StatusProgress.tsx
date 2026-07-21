'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectStatus } from '@/lib/types';
import { setProjectStatusAction, setProjectProgressAction } from '@/app/actions/projects';
import { ProgressBar } from '@/components/ui';

const STATUSES: { key: ProjectStatus; label: string }[] = [
  { key: 'not_started', label: 'Not Started' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
];

export function StatusProgress({
  id,
  status,
  progress,
}: {
  id: number;
  status: ProjectStatus;
  progress: number;
}) {
  const [pending, start] = useTransition();
  const [localProgress, setLocalProgress] = useState(progress);
  const router = useRouter();

  function changeStatus(s: ProjectStatus) {
    start(async () => {
      await setProjectStatusAction(id, s);
      router.refresh();
    });
  }

  function clamp(v: number) {
    if (Number.isNaN(v)) return 0;
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  function commitProgress(v: number) {
    const next = clamp(v);
    setLocalProgress(next);
    start(async () => {
      await setProjectProgressAction(id, next);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="label">Status</p>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              disabled={pending}
              onClick={() => changeStatus(s.key)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${
                status === s.key
                  ? 'border-brand-green bg-brand-green text-brand-ink'
                  : 'border-black/10 bg-white text-brand-gray hover:bg-black/5'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="label mb-0">Progress</p>
          <span className="text-sm font-semibold text-brand-ink">{localProgress}%</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={localProgress}
            disabled={pending}
            onChange={(e) => setLocalProgress(clamp(Number(e.target.value)))}
            onBlur={(e) => commitProgress(Number(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitProgress(Number((e.target as HTMLInputElement).value));
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="input w-24"
            aria-label="Percent of job complete"
          />
          <span className="text-sm text-brand-gray">% complete</span>
        </div>
        <div className="mt-3">
          <ProgressBar value={localProgress} />
        </div>
      </div>
    </div>
  );
}
