import Link from 'next/link';
import {
  getProjectHubCounts,
  listInvoiceTallies,
  projectHours,
} from '@/lib/data';
import { listScheduleTasks, listHolidays } from '@/lib/schedule-data';
import { computeSchedule, projectedEnd } from '@/lib/schedule-math';
import { billingSummary, EMPTY_TALLY, BILLING_STAGE_LABELS } from '@/lib/billing';
import { money, shortDate } from '@/lib/format';
import { BillingStageBadge, OnHoldBadge } from '@/components/ui';
import { loadProject, requireJobUser, canBill } from './job';
import { StatusProgress } from './StatusProgress';
import { OnHoldControl } from '@/app/(app)/schedule/OnHoldControl';

export const dynamic = 'force-dynamic';

/**
 * The job at a glance: where it stands, the four dates and how they relate,
 * and one line per tab saying what's waiting there.
 *
 * The dates are the reason this page exists in its own right. A job carries
 * four of them and they are not interchangeable — two are typed by a person,
 * one is computed from the phases, and one is a promise to the customer — so
 * they are grouped and labelled by what they *are* rather than lined up as four
 * identical tiles.
 */
export default async function ProjectOverview({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireJobUser();
  const { id: idParam } = await params;
  const project = await loadProject(idParam);
  const id = project.id;

  const [hours, counts, tasks, holidays, tallies] = await Promise.all([
    projectHours(id),
    getProjectHubCounts(id),
    listScheduleTasks({ projectId: id }),
    listHolidays(),
    canBill(user) ? listInvoiceTallies([id]) : Promise.resolve(new Map()),
  ]);

  // Projected finish = the latest end across the phases, dependency chains resolved.
  const projectedFinish = projectedEnd(
    tasks.map((t) => t.id),
    computeSchedule(tasks, { holidays: new Set(holidays.map((h) => h.day)) }).windows
  );

  const pastDue = !!(projectedFinish && project.due_date && projectedFinish > project.due_date);
  const pastHard = !!(
    projectedFinish &&
    project.hard_finish_date &&
    projectedFinish > project.hard_finish_date
  );

  const billing = canBill(user)
    ? billingSummary(project, tallies.get(id) ?? EMPTY_TALLY)
    : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="brand-heading text-sm text-brand-gray">Status &amp; Progress</h2>
            {/* A hold is not a fourth status — it sits alongside them. The job
                is still where it was; what the hold records is that nothing is
                waiting on us. */}
            <div className="flex items-center gap-2">
              {project.on_hold && (
                <OnHoldBadge reason={project.on_hold_reason} since={project.on_hold_since} />
              )}
              <OnHoldControl
                projectId={id}
                projectName={project.name}
                onHold={project.on_hold}
                reason={project.on_hold_reason}
                since={project.on_hold_since}
                compact={false}
              />
            </div>
          </div>
          <StatusProgress id={id} status={project.status} progress={project.progress} />
          {project.on_hold && project.on_hold_reason && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              On hold — waiting on {project.on_hold_reason}
              {project.on_hold_since ? ` · since ${shortDate(project.on_hold_since)}` : ''}
            </p>
          )}
        </div>

        <div className="card p-5">
          <h2 className="brand-heading text-sm text-brand-gray">Dates</h2>
          <p className="mb-4 mt-0.5 text-xs text-brand-gray">
            What was planned, what the phases now say, and what the job is answerable to
          </p>

          <div className="space-y-4">
            <DateRow
              label="Planned"
              detail="Entered by hand for the work"
              items={[
                { label: 'Start', value: shortDate(project.start_date) },
                { label: 'End', value: shortDate(project.end_date) },
              ]}
            />
            <DateRow
              label="Projected finish"
              detail={
                tasks.length === 0
                  ? 'No phases scheduled yet — nothing to project from'
                  : `Computed from ${tasks.length} phase${tasks.length === 1 ? '' : 's'}, dependency chains resolved`
              }
              items={[{ label: 'Finish', value: shortDate(projectedFinish), alert: pastDue || pastHard }]}
            />
            <DateRow
              label="Answerable to"
              detail="The target, and the date that can't move"
              items={[
                { label: 'Due', value: shortDate(project.due_date), alert: pastDue },
                {
                  label: 'Must finish by',
                  value: shortDate(project.hard_finish_date),
                  alert: pastHard,
                },
              ]}
            />
          </div>

          {pastHard && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              The planned work runs past the date this job must be finished by.
            </p>
          )}
          {pastDue && !pastHard && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
              The planned work runs past the due date.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="card p-5">
          <h2 className="brand-heading mb-1 text-sm text-brand-gray">Elsewhere on this job</h2>
          <p className="mb-4 text-xs text-brand-gray">Each opens its own tab</p>
          <ul className="divide-y divide-surface-line">
            <TabLink
              href={`/projects/${id}/schedule`}
              label="Schedule"
              value={
                counts.phases === 0
                  ? 'Not planned yet'
                  : `${counts.phases} phase${counts.phases === 1 ? '' : 's'}`
              }
            />
            {billing && (
              <TabLink
                href={`/projects/${id}/billing`}
                label="Billing"
                value={
                  billing.count === 0
                    ? BILLING_STAGE_LABELS[billing.stage]
                    : `${money(billing.outstanding)} outstanding`
                }
                badge={<BillingStageBadge stage={billing.stage} />}
              />
            )}
            <TabLink
              href={`/projects/${id}/time`}
              label="Time"
              value={`${hours.toFixed(1)}h logged${
                counts.timeEntries ? ` · ${counts.timeEntries} entries` : ''
              }`}
            />
            <TabLink
              href={`/projects/${id}/notes`}
              label="Notes"
              value={`${counts.notes} internal · ${counts.crewNotes} for the crew`}
            />
            <TabLink
              href={`/projects/${id}/files`}
              label="Files"
              value={
                counts.files === 0
                  ? 'None attached'
                  : `${counts.files} file${counts.files === 1 ? '' : 's'}`
              }
            />
            {/* Behind the same gate as Billing: what a job cost is the other
                half of what it was sold for, and neither belongs on an
                employee's view of the job. */}
            {billing && (
              <TabLink
                href={`/projects/${id}/receipts`}
                label="Receipts"
                value={
                  counts.receipts === 0
                    ? 'None yet'
                    : `${counts.receipts} · ${money(counts.receiptTotal, { cents: true })}`
                }
              />
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** One labelled group of dates, with what kind of date it is spelled out. */
function DateRow({
  label,
  detail,
  items,
}: {
  label: string;
  detail: string;
  items: { label: string; value: string; alert?: boolean }[];
}) {
  return (
    <div className="rounded-lg border border-surface-line p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{label}</p>
      <p className="mt-0.5 text-xs text-brand-gray">{detail}</p>
      <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
        {items.map((it) => (
          <div key={it.label}>
            <p className="text-xs text-brand-gray">{it.label}</p>
            <p
              className={`tnum text-base font-bold ${
                it.alert ? 'text-amber-700' : 'text-brand-ink'
              }`}
            >
              {it.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabLink({
  href,
  label,
  value,
  badge,
}: {
  href: string;
  label: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 py-2.5 text-sm transition hover:text-brand-green-dark"
      >
        <span className="font-medium text-brand-ink">{label}</span>
        <span className="flex items-center gap-2 text-right text-xs text-brand-gray">
          {badge}
          {value}
        </span>
      </Link>
    </li>
  );
}
