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

  function commitProgress(v: number) {
    start(async () => {
      await setProjectProgressAction(id, v);
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
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={localProgress}
          disabled={pending}
          onChange={(e) => setLocalProgress(Number(e.target.value))}
          onMouseUp={(e) => commitProgress(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => commitProgress(Number((e.target as HTMLInputElement).value))}
          className="w-full accent-brand-green"
        />
        <div className="mt-2">
          <ProgressBar value={localProgress} />
        </div>
      </div>
    </div>
  );
}
