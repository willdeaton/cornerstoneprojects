'use client';

import { useState } from 'react';
import type { ScheduleTaskRow, WarehouseDay } from '@/lib/types';
import { ScheduleBoard, type BoardProject } from './ScheduleBoard';
import { CrewWeek } from './CrewWeek';
import { ScheduleSaveBar } from './ScheduleSaveBar';
import { useScheduleDraft } from './useScheduleDraft';
import type { DraftJob } from './PublishModal';
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
 * The two halves of scheduling, over one load of the same rows — and the draft
 * both of them edit.
 *
 * The timeline plans WORK — durations, dependencies, and the headcount each
 * phase needs. The crew week staffs it — the actual people, a day at a time,
 * plus the start times and notes they'll read. Both derive their dates from
 * schedule-math, so switching never shows two different answers.
 *
 * The draft is held here rather than in either view, so an edit made on the
 * timeline is already there when you switch to the crew week, and one Save
 * writes the lot. Nothing either view does emails anybody: only the Publish
 * button on the bar above them does that.
 */
export function ScheduleViews({
  tasks,
  warehouse,
  projects,
  workers,
  subs,
  holidays,
  published,
  changeCounts,
  canUnpublish,
  drafts,
}: {
  tasks: ScheduleTaskRow[];
  /** Who is in the warehouse on which day — the crew week's standing card. */
  warehouse: WarehouseDay[];
  /** Every live job, so the timeline can list the unplanned ones too. */
  projects: BoardProject[];
  workers: WorkerOption[];
  subs: SubOption[];
  holidays: string[];
  published: Record<number, PublishedInfo>;
  /** Logged schedule changes per job id. */
  changeCounts: Record<number, number>;
  canUnpublish: boolean;
  /** Jobs whose schedule has moved since the crew was last sent it. */
  drafts: DraftJob[];
}) {
  const [view, setView] = useState<View>('timeline');
  const draft = useScheduleDraft(tasks, holidays, warehouse);

  return (
    <div className="space-y-4">
      <ScheduleSaveBar draft={draft} drafts={drafts} holidays={holidays} canPublish />

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
          tasks={draft.tasks}
          projects={projects}
          subs={subs}
          holidays={holidays}
          published={published}
          changeCounts={changeCounts}
          canUnpublish={canUnpublish}
          draft={draft}
        />
      ) : (
        <CrewWeek
          tasks={draft.tasks}
          warehouse={draft.warehouse}
          workers={workers}
          subs={subs}
          holidays={holidays}
          published={published}
          draft={draft}
        />
      )}
    </div>
  );
}
