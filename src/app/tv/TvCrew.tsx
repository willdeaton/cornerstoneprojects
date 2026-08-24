import { fromDay, mondayLabel, weekStart } from '@/lib/schedule-math';
import { CARD, PHASE_TINT, TEXT } from './tv-style';
import type { CrewRow, CrewWeekModel } from './tv-board';

/**
 * The crew week panel: where everybody is, a day at a time.
 *
 * The question a room asks a schedule board more than any other is "where is
 * so-and-so this week", and neither the day cards nor the job timeline answers
 * it directly — one is grouped by job, the other by weeks. This is grouped by
 * person, which is the shape the question comes in.
 *
 * People with nothing booked keep their line, greyed: half the reason to look
 * is to find somebody who is free.
 */
export function TvCrew({
  model,
  rows,
  pages,
  firstRow,
  today,
  holidays,
}: {
  model: CrewWeekModel;
  /** This screen's people — a slice of `model.rows`. */
  rows: CrewRow[];
  pages: number;
  /** 1-based index of the first person on this screen. */
  firstRow: number;
  today: string;
  holidays: Set<string>;
}) {
  const { columns, bands } = model;
  const template = `minmax(9rem, 13%) repeat(${columns.length}, minmax(0, 1fr))`;
  const booked = model.rows.filter((r) => r.bookedDays > 0).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[0.8vw]">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 className={`${TEXT.heading} font-semibold text-white`}>
          Crew week
          <span className="ml-3 font-normal text-white/50">
            {mondayLabel(model.start)} – {mondayLabel(model.end)}
          </span>
        </h2>
        <p className={`${TEXT.small} text-white/45`}>
          {pages > 1
            ? `People ${firstRow}–${firstRow + rows.length - 1} of ${model.rows.length}`
            : `${booked} of ${model.rows.length} booked`}
        </p>
      </div>

      <div className={`${CARD} flex min-h-0 flex-1 flex-col overflow-hidden`}>
        <div
          className="grid border-b border-white/10 bg-white/[0.03]"
          style={{ gridTemplateColumns: template }}
        >
          <div className={`${TEXT.eyebrow} px-[0.8vw] py-1.5 text-white/40`}>Crew</div>
          {bands.map((b) => (
            <div
              key={b.monday}
              style={{ gridColumn: `${b.startIdx + 2} / ${b.startIdx + b.span + 2}` }}
              className={`${TEXT.micro} border-l border-white/10 px-2 py-1.5 font-semibold ${
                b.monday === weekStart(today) ? 'text-brand-green' : 'text-white/45'
              }`}
            >
              Week of {mondayLabel(b.monday)}
            </div>
          ))}
        </div>
        <div className="grid border-b border-white/10" style={{ gridTemplateColumns: template }}>
          <div />
          {columns.map((d) => (
            <div
              key={d}
              className={`${TEXT.micro} py-1 text-center leading-tight ${
                d === today
                  ? 'font-bold text-brand-green'
                  : isOff(d, holidays)
                    ? 'text-white/30'
                    : 'text-white/45'
              }`}
            >
              <div>{fromDay(d).toLocaleDateString('en-US', { weekday: 'short' })}</div>
              <div>{fromDay(d).getDate()}</div>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className={`${TEXT.heading} font-semibold text-white/70`}>Nobody in scheduling</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {rows.map((row) => (
              <PersonRow
                key={row.key}
                row={row}
                columns={columns}
                template={template}
                today={today}
                holidays={holidays}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One person's line: their name, then the cards they're booked on. */
function PersonRow({
  row,
  columns,
  template,
  today,
  holidays,
}: {
  row: CrewRow;
  columns: string[];
  template: string;
  today: string;
  holidays: Set<string>;
}) {
  const free = row.bookedDays === 0;
  return (
    <div
      className="grid flex-1 border-b border-white/[0.06] last:border-0"
      style={{
        gridTemplateColumns: template,
        gridTemplateRows: `repeat(${row.lanes}, minmax(0, 1fr))`,
      }}
    >
      <div
        style={{ gridRow: '1 / -1', gridColumn: 1 }}
        className="flex min-w-0 flex-col justify-center px-[0.8vw]"
      >
        <span
          className={`${TEXT.small} truncate font-semibold ${free ? 'text-white/35' : 'text-white'}`}
        >
          {row.name}
        </span>
        <span className={`${TEXT.micro} truncate ${free ? 'text-white/25' : 'text-white/40'}`}>
          {/* Subs earn their trade beside their name; our own people are
              identified by the days beside them, not by a job title. */}
          {row.kind === 'sub'
            ? row.detail ?? 'Subcontractor'
            : free
              ? 'Not booked'
              : `${row.bookedDays} ${row.bookedDays === 1 ? 'day' : 'days'}`}
        </span>
      </div>

      {columns.map((d, i) => (
        <div
          key={d}
          style={{ gridRow: '1 / -1', gridColumn: i + 2 }}
          className={`border-l border-white/[0.06] ${
            d === today ? 'bg-brand-green/10' : isOff(d, holidays) ? 'bg-black/30' : ''
          }`}
        />
      ))}

      {row.spans.map((span) => (
        <div
          key={`${span.key}-${span.startIdx}`}
          style={{
            gridRow: span.lane + 1,
            gridColumn: `${span.startIdx + 2} / ${span.endIdx + 3}`,
          }}
          className={`z-10 my-[2px] flex min-w-0 flex-col justify-center self-center overflow-hidden rounded px-2 py-1 ${
            span.status ? PHASE_TINT[span.status] : 'border border-dashed border-white/25 text-white/70'
          } ${span.clash ? 'ring-2 ring-red-500' : ''}`}
        >
          <span className={`${TEXT.micro} truncate font-semibold leading-tight`}>{span.label}</span>
          {(span.phase || span.shift) && (
            <span className={`${TEXT.micro} truncate leading-tight opacity-75`}>
              {[span.shift, span.phase].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** A day nobody works: weekend or a listed holiday. */
function isOff(day: string, holidays: Set<string>): boolean {
  const dow = fromDay(day).getDay();
  return dow === 0 || dow === 6 || holidays.has(day);
}
