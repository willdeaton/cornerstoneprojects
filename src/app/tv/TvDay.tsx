import { fromDay, shiftShort } from '@/lib/schedule-math';
import { TASK_STATUS_LABELS } from '@/lib/types';
import { CARD, PHASE_BADGE, TEXT } from './tv-style';
import type { DayBoard, DayJob } from './tv-board';

/** Past this many jobs the cards drop the detail that stops fitting. */
const DENSE_FROM = 7;
/** How many jobs the "next up" rail lists before it counts the rest. */
const MAX_NEXT = 5;

/**
 * The day panel: who is out, where, and when they start.
 *
 * This is the half of the board the office actually stands and looks at —
 * somebody wants to know whether Dave is on the hospital job or in the
 * warehouse, and they want it without touching anything. So the cards lead with
 * the job and the names on it, the earliest start sorts to the top, and the
 * rail beside them answers the two follow-up questions: what's on tomorrow, and
 * who isn't booked.
 */
export function TvDay({
  board,
  next,
  available,
  today,
}: {
  board: DayBoard;
  /** The next day with work on it — Monday, when this is read on a Friday. */
  next: DayBoard;
  /** Our own schedulable people with nothing booked today. */
  available: string[];
  today: string;
}) {
  // Every job on today gets a card. A job the board decided not to draw is a
  // crew nobody in the office knows about, so what gives way as the day fills
  // up is the detail on the card, never the card.
  const density: Density =
    board.jobs.length <= 2 ? 'roomy' : board.jobs.length >= DENSE_FROM ? 'dense' : 'normal';

  return (
    <div className="flex min-h-0 flex-1 gap-[1.2vw]">
      {/* The day itself */}
      <div className="flex min-w-0 flex-1 flex-col gap-[1vw]">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 className={`${TEXT.heading} font-semibold text-white`}>
            {board.day === today ? 'On site today' : 'On site'}
            <span className="ml-3 font-normal text-white/50">{longDay(board.day)}</span>
          </h2>
          <div className="flex flex-wrap gap-[1vw]">
            <Stat label="Jobs" value={board.jobs.length} />
            <Stat label="Crew out" value={board.headcount} accent />
            <Stat label="Warehouse" value={board.warehouse.length} />
            <Stat label="Not booked" value={available.length} />
          </div>
        </div>

        {board.jobs.length === 0 ? (
          <div className={`${CARD} flex flex-1 flex-col items-center justify-center text-center`}>
            <p className={`${TEXT.heading} font-semibold text-white/80`}>Nobody booked on a job</p>
            <p className={`${TEXT.body} mt-2 text-white/45`}>
              Nothing is scheduled for {longDay(board.day)}.
            </p>
          </div>
        ) : (
          <div
            className={`grid min-h-0 flex-1 auto-rows-fr overflow-hidden ${
              density === 'dense' ? 'gap-[0.6vw]' : 'gap-[1vw]'
            }`}
            style={{ gridTemplateColumns: `repeat(${columns(board.jobs.length)}, minmax(0, 1fr))` }}
          >
            {board.jobs.map((job) => (
              <JobCard key={job.projectId} job={job} density={density} />
            ))}
          </div>
        )}
      </div>

      {/* What's next, and who's spare */}
      <aside className="flex w-[24%] min-w-[15rem] max-w-[26rem] flex-col gap-[1vw]">
        <section className={`${CARD} flex min-h-0 flex-1 flex-col p-[1vw]`}>
          <p className={`${TEXT.eyebrow} text-brand-green`}>Next up</p>
          <p className={`${TEXT.body} mt-0.5 font-semibold text-white`}>{longDay(next.day)}</p>
          {next.jobs.length === 0 && next.warehouse.length === 0 ? (
            <p className={`${TEXT.small} mt-3 text-white/40`}>Nothing booked yet.</p>
          ) : (
            <ul className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-hidden">
              {next.jobs.slice(0, MAX_NEXT).map((job) => (
                <li key={job.projectId} className="border-l-2 border-white/15 pl-2.5">
                  <p className={`${TEXT.small} truncate font-semibold text-white`}>{job.name}</p>
                  <p className={`${TEXT.micro} truncate text-white/45`}>
                    {job.headcount} {job.headcount === 1 ? 'person' : 'people'}
                    {job.shift ? ` · ${job.shift}` : ''}
                  </p>
                </li>
              ))}
              {next.jobs.length > MAX_NEXT && (
                <li className={`${TEXT.micro} text-white/40`}>
                  +{next.jobs.length - MAX_NEXT} more
                </li>
              )}
              {next.warehouse.length > 0 && (
                <li className={`${TEXT.micro} border-l-2 border-white/15 pl-2.5 text-white/45`}>
                  Warehouse: {next.warehouse.map((w) => w.name).join(', ')}
                </li>
              )}
            </ul>
          )}
        </section>

        <section className={`${CARD} p-[1vw]`}>
          <p className={`${TEXT.eyebrow} text-white/45`}>Warehouse today</p>
          <p className={`${TEXT.small} mt-1.5 text-white/85`}>
            {board.warehouse.length === 0
              ? 'Nobody in'
              : board.warehouse.map((w) => w.name).join(', ')}
          </p>
        </section>

        <section className={`${CARD} p-[1vw]`}>
          <p className={`${TEXT.eyebrow} text-white/45`}>Not booked today</p>
          <p className={`${TEXT.small} mt-1.5 text-white/85`}>
            {available.length === 0 ? 'Everybody is on something' : available.join(', ')}
          </p>
        </section>
      </aside>
    </div>
  );
}

/** How much room a card has, which is really how busy the day is. */
type Density = 'roomy' | 'normal' | 'dense';

const SIZES: Record<Density, { name: string; sub: string; shift: string; phase: string; chip: string }> = {
  roomy: { name: TEXT.heading, sub: TEXT.body, shift: TEXT.heading, phase: TEXT.body, chip: TEXT.small },
  normal: { name: TEXT.name, sub: TEXT.small, shift: TEXT.body, phase: TEXT.small, chip: TEXT.micro },
  dense: { name: TEXT.body, sub: TEXT.micro, shift: TEXT.small, phase: TEXT.small, chip: TEXT.micro },
};

/**
 * One job with people on it today.
 *
 * A card grows into the room it has: a two-job day is read from further back
 * than a nine-job one, so the same card sets its type a step larger when the
 * board isn't busy rather than leaving the screen half empty. A busy day goes
 * the other way and sheds what the room can do without — the status word and
 * the site address — so that the job, the shift and the names on it are still
 * whole on every card.
 */
function JobCard({ job, density }: { job: DayJob; density: Density }) {
  const size = SIZES[density];
  const dense = density === 'dense';

  return (
    <article
      className={`${CARD} flex flex-col overflow-hidden ${dense ? 'p-[0.6vw]' : 'p-[0.9vw]'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={`${size.name} line-clamp-2 font-semibold leading-tight text-white`}>
            {job.name}
          </h3>
          <p className={`${size.sub} truncate text-white/50`}>{job.customer}</p>
        </div>
        <span
          className={`${size.chip} shrink-0 rounded-full bg-white/10 px-2.5 py-1 font-semibold text-white/80`}
        >
          {job.headcount}
          {dense ? '' : ` ${job.headcount === 1 ? 'person' : 'people'}`}
        </span>
      </div>

      {/* One shift for everybody is said once, up here, where it's read first. */}
      {job.shift && (
        <p className={`${size.shift} ${dense ? 'mt-1' : 'mt-1.5'} font-semibold text-brand-green`}>
          {job.shift}
        </p>
      )}

      <div className={dense ? 'mt-1 space-y-1' : 'mt-2 space-y-2'}>
        {job.phases.map((phase) => (
          <div key={phase.taskId}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={`${size.phase} font-semibold text-white/90`}>{phase.name}</span>
              {/* The status word is the first thing to go on a busy day: it's
                  the least of what a card says, and the crew names are the most. */}
              {!dense && (
                <span
                  className={`${size.chip} rounded-full px-2 py-0.5 font-semibold ${
                    PHASE_BADGE[phase.status]
                  }`}
                >
                  {TASK_STATUS_LABELS[phase.status]}
                </span>
              )}
              {/* Only worth repeating when it isn't the job's own shift above. */}
              {phase.shift && phase.shift !== job.shift && (
                <span className={`${size.chip} font-semibold text-brand-green`}>{phase.shift}</span>
              )}
            </div>
            <div className={`flex flex-wrap gap-1.5 ${dense ? 'mt-1' : 'mt-1.5'}`}>
              {phase.crew.map((c) => (
                <span
                  key={c.key}
                  className={`${size.chip} rounded-md font-medium ${dense ? 'px-2 py-0.5' : 'px-2.5 py-1'} ${
                    c.kind === 'sub'
                      ? 'border border-dashed border-white/30 text-white/70'
                      : 'bg-white/10 text-white'
                  }`}
                >
                  {c.name}
                  {/* A phase whose people work different shifts says each one. */}
                  {!phase.shift && shiftShort(c) && (
                    <span className="ml-1 text-brand-green">{shiftShort(c)}</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!dense && (job.siteAddress || job.location) && (
        <p className={`${size.chip} mt-auto truncate pt-2 text-white/40`}>
          {job.siteAddress ?? job.location}
        </p>
      )}
    </article>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="text-right">
      <p className={`${TEXT.eyebrow} text-white/40`}>{label}</p>
      <p
        className={`${TEXT.stat} font-semibold leading-none ${
          accent ? 'text-brand-green' : 'text-white'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * How many columns the day's cards run in.
 *
 * A board is a wall, not a page: two jobs should be two big cards filling the
 * screen, not two narrow ones with dead space beside them. As the day fills up
 * the grid divides instead of scrolling, because every job has to stay on
 * screen — a wall board with a "+3 more" on it is a wall board somebody has to
 * go and check.
 */
function columns(cards: number): number {
  if (cards <= 2) return Math.max(1, cards);
  if (cards <= 4) return 2;
  if (cards <= 9) return 3;
  return 4;
}

/** "Monday, August 24" — the day spelled out, because a board is read at a glance. */
function longDay(day: string): string {
  return fromDay(day).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
