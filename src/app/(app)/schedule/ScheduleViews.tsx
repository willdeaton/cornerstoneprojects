'use client';

import { useState } from 'react';
import type { ScheduleTaskRow } from '@/lib/types';
import { ScheduleBoard } from './ScheduleBoard';
import { CrewWeek } from './CrewWeek';
import type { ProjectOption, SubOption, WorkerOption } from './TaskModal';
import type { PublishedInfo } from './PublishBar';

type View = 'timeline' | 'crew';

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: 'timeline', label: 'Job Timeline', hint: 'Phases across every live job' },
  { id: 'crew', label: 'Crew Week', hint: 'What each employee is doing this week' },
];

/**
 * The two ways managers read the schedule, over one load of the same rows: by
 * job (the timeline) or by person (the week grid). Both derive their dates from
 * schedule-math, so switching never shows two different answers.
 */
export function ScheduleViews({
  tasks,
  projects,
  workers,
  subs,
  holidays,
  published,
  canUnpublish,
}: {
  tasks: ScheduleTaskRow[];
  projects: ProjectOption[];
  workers: WorkerOption[];
  subs: SubOption[];
  holidays: string[];
  published: Record<number, PublishedInfo>;
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
              view === v.id ? 'bg-brand-green text-white' : 'text-brand-gray hover:bg-black/5'
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
          workers={workers}
          subs={subs}
          holidays={holidays}
          published={published}
          canUnpublish={canUnpublish}
        />
      ) : (
        <CrewWeek tasks={tasks} workers={workers} subs={subs} holidays={holidays} />
      )}
    </div>
  );
}
