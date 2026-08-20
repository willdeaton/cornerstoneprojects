'use client';

import { useState } from 'react';
import type { ScheduleTaskRow } from '@/lib/types';
import { ScheduleBoard, type BoardProject } from './ScheduleBoard';
import { CrewWeek } from './CrewWeek';
import type { SubOption, WorkerOption } from './TaskModal';
import type { PublishedInfo } from './PublishBar';

type View = 'timeline' | 'crew';

const VIEWS: { id: View; label: string; hint: string }[] = [
  {
    id: 'timeline',
    label: 'Job Timeline',
    hint: 'Plan the work: how long each phase runs and how many people it takes',
  },
  {
    id: 'crew',
    label: 'Crew Week',
    hint: 'Staff that work: two weeks at a time, who is on which job and phase each day, and when they start',
  },
];

/**
 * The two halves of scheduling, over one load of the same rows.
 *
 * The timeline plans WORK — durations, dependencies, and the headcount each
 * phase needs. The crew week staffs it — the actual people, a day at a time,
 * plus the start times and notes they'll read. Both derive their dates from
 * schedule-math, so switching never shows two different answers.
 */
export function ScheduleViews({
  tasks,
  projects,
  workers,
  subs,
  holidays,
  published,
  changeCounts,
  canUnpublish,
}: {
  tasks: ScheduleTaskRow[];
  /** Every live job, so the timeline can list the unplanned ones too. */
  projects: BoardProject[];
  workers: WorkerOption[];
  subs: SubOption[];
  holidays: string[];
  published: Record<number, PublishedInfo>;
  /** Logged schedule changes per job id. */
  changeCounts: Record<number, number>;
  canUnpublish: boolean;
}) {
  const [view, setView] = useState<View>('timeline');

  return (
    <div className="space-y-4">
      <div className="flex overflow-hidden rounded-lg border border-black/10">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            title={v.hint}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              view === v.id ? 'bg-brand-green font-semibold text-brand-ink' : 'text-brand-gray hover:bg-black/5'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'timeline' ? (
        <ScheduleBoard
          tasks={tasks}
          projects={projects}
          subs={subs}
          holidays={holidays}
          published={published}
          changeCounts={changeCounts}
          canUnpublish={canUnpublish}
        />
      ) : (
        <CrewWeek tasks={tasks} workers={workers} holidays={holidays} published={published} />
      )}
    </div>
  );
}
