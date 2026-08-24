import { Fragment } from 'react';
import { fromDay, mondayLabel, weekStart } from '@/lib/schedule-math';
import { shortDate } from '@/lib/format';
import { CARD, JOB_DOT, PHASE_TINT, TEXT } from './tv-style';
import type { TimelineModel, TimelineRow } from './tv-board';

/**
 * The timeline panel: which jobs are running which weeks.
 *
 * The same bars the Schedule's Job Timeline draws — one per unbroken run of
 * working days, so a weekend reads as the gap it is — with the phases of a job
 * stacked into lanes inside one row per job. A board seen from across the room
 * is answering "what are we on next week", and a row per job answers that in
 * one pass where a row per phase would make somebody count.
 *
 * Long boards page rather than shrink: `TvBoard` hands this one screen of jobs
 * at a time and rotates through the rest, because a bar too short to read is
 * worse than a bar you wait four seconds for.
 */
export function TvTimeline({
  model,
  rows,
  page,
  pages,
  firstRow,
  today,
  holidays,
}: {
  model: TimelineModel;
  /** This screen's jobs — a slice of `model.rows`. */
  rows: TimelineRow[];
  page: number;
  pages: number;
  /** 1-based index of the first job on this screen, for "Jobs 8–14 of 20". */
  firstRow: number;
  today: string;
  holidays: Set<string>;
}) {
  const { days, bands } = model;
  // A label column wide enough for a job name, then one equal column per day.
  const template = `minmax(12rem, 17%) repeat(${days.length}, minmax(0, 1fr))`;
  const thisWeek = weekStart(today);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[0.8vw]">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 className={`${TEXT.heading} font-semibold text-white`}>
          Job timeline
          <span className="ml-3 font-normal text-white/50">
            {mondayLabel(model.start)} – {mondayLabel(model.end)}
          </span>
        </h2>
        <p className={`${TEXT.small} text-white/45`}>
          {model.rows.length === 0
            ? 'No work scheduled in these weeks'
            : pages > 1
              ? `Jobs ${firstRow}–${firstRow + rows.length - 1} of ${model.rows.length}`
              : `${model.rows.length} ${model.rows.length === 1 ? 'job' : 'jobs'}`}
        </p>
      </div>

      <div className={`${CARD} flex min-h-0 flex-1 flex-col overflow-hidden`}>
        {/* Week band, then the days — the same Monday-anchored weeks the
            Schedule runs in, so the same weekday is always the same column. */}
        <div
          className="grid border-b border-white/10 bg-white/[0.03]"
          style={{ gridTemplateColumns: template }}
        >
          <div className={`${TEXT.eyebrow} px-[0.8vw] py-1.5 text-white/40`}>Job</div>
          {bands.map((b) => (
            <div
              key={b.monday}
              style={{ gridColumn: `${b.startIdx + 2} / ${b.startIdx + b.span + 2}` }}
              className={`${TEXT.micro} border-l border-white/10 px-2 py-1.5 font-semibold ${
                b.monday === thisWeek ? 'text-brand-green' : 'text-white/45'
              }`}
            >
              Week of {mondayLabel(b.monday)}
            </div>
          ))}
        </div>
        <div
          className="grid border-b border-white/10"
          style={{ gridTemplateColumns: template }}
        >
          <div />
          {days.map((d) => (
            <div
              key={d}
              className={`${TEXT.micro} py-1 text-center leading-tight ${
                d === today
                  ? 'font-bold text-brand-green'
                  : isOff(d, holidays)
                    ? 'text-white/25'
                    : 'text-white/45'
              }`}
            >
              <div>{fromDay(d).toLocaleDateString('en-US', { weekday: 'narrow' })}</div>
              <div>{fromDay(d).getDate()}</div>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className={`${TEXT.heading} font-semibold text-white/80`}>Nothing on the board</p>
            <p className={`${TEXT.body} mt-2 text-white/45`}>
              No job has work scheduled between {shortDate(model.start)} and{' '}
              {shortDate(model.end)}.
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {rows.map((row) => (
              <JobRow
                key={row.projectId}
                row={row}
                days={days}
                template={template}
                today={today}
                holidays={holidays}
              />
            ))}
          </div>
        )}
      </div>

      {model.unscheduled.length > 0 && (
        <p className={`${TEXT.small} truncate text-white/40`}>
          <span className="font-semibold text-white/60">Not scheduled yet:</span>{' '}
          {model.unscheduled
            .slice(0, 6)
            .map((p) => p.name)
            .join(' · ')}
          {model.unscheduled.length > 6 ? ` +${model.unscheduled.length - 6} more` : ''}
        </p>
      )}
    </div>
  );
}

/** One job: its phases as bars, stacked into lanes where they overlap. */
function JobRow({
  row,
  days,
  template,
  today,
  holidays,
}: {
  row: TimelineRow;
  days: string[];
  template: string;
  today: string;
  holidays: Set<string>;
}) {
  return (
    <div
      className="grid flex-1 border-b border-white/[0.06] last:border-0"
      style={{
        gridTemplateColumns: template,
        gridTemplateRows: `repeat(${row.lanes}, minmax(0, 1fr))`,
      }}
    >
      <div
        style={{ gridRow: `1 / -1`, gridColumn: 1 }}
        className="flex min-w-0 flex-col justify-center px-[0.8vw] py-1"
      >
        <div className="flex items-start gap-2">
          <span className={`mt-[0.45em] h-2 w-2 shrink-0 rounded-full ${JOB_DOT[row.status]}`} />
          <span className={`${TEXT.small} line-clamp-2 font-semibold leading-tight text-white`}>
            {row.name}
          </span>
        </div>
        <span className={`${TEXT.micro} truncate pl-4 text-white/45`}>
          {row.phases} {row.phases === 1 ? 'phase' : 'phases'} · {mondayLabel(row.start)} –{' '}
          {mondayLabel(row.end)}
        </span>
        {row.toBook > 0 && (
          <span className={`${TEXT.micro} truncate pl-4 font-semibold text-status-progress`}>
            {row.toBook} crew {row.toBook === 1 ? 'day' : 'days'} to book
          </span>
        )}
      </div>

      {/* The day columns themselves — weekends and holidays sunk, today lit. */}
      {days.map((d, i) => (
        <div
          key={d}
          style={{ gridRow: `1 / -1`, gridColumn: i + 2 }}
          className={`border-l border-white/[0.06] ${
            d === today
              ? 'bg-brand-green/10'
              : isOff(d, holidays)
                ? 'bg-black/30'
                : ''
          }`}
        />
      ))}

      {row.bars.map((bar) => {
        // A one- or two-day bar has no room for a phase name inside it, so the
        // name goes beside it instead of being cut to three letters. A board
        // nobody can read the labels on isn't showing anything.
        // Anything under four columns wide is narrower than its own name.
        const narrow = bar.endIdx - bar.startIdx < 3;
        const beside = bar.leading && narrow && bar.gapAfter >= 1;
        return (
          <Fragment key={bar.key}>
            <div
              style={{
                gridRow: bar.lane + 1,
                gridColumn: `${bar.startIdx + 2} / ${bar.endIdx + 3}`,
              }}
              className={`z-10 flex h-[clamp(1.5rem,4vh,3rem)] items-center self-center overflow-hidden rounded px-2 ${
                PHASE_TINT[bar.status]
              } ${bar.clippedLeft ? 'rounded-l-none' : ''} ${
                bar.clippedRight ? 'rounded-r-none' : ''
              }`}
            >
              {/* Only the first stretch is labelled; the rest are the same phase
                  carrying on after a weekend. */}
              {bar.leading && !beside && (
                <span className={`${TEXT.micro} truncate font-semibold`}>{bar.label}</span>
              )}
            </div>
            {beside && (
              <div
                style={{
                  gridRow: bar.lane + 1,
                  gridColumn: `${bar.endIdx + 3} / ${bar.endIdx + 3 + bar.gapAfter}`,
                }}
                className="z-10 flex items-center self-center overflow-hidden pl-2"
              >
                <span className={`${TEXT.micro} truncate font-semibold text-white/85`}>
                  {bar.label}
                </span>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** A day nobody works: weekend or a listed holiday. */
function isOff(day: string, holidays: Set<string>): boolean {
  const dow = fromDay(day).getDay();
  return dow === 0 || dow === 6 || holidays.has(day);
}
