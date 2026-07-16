import type { ProjectStatus, QuoteStatus } from '@/lib/types';

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="brand-heading text-2xl text-brand-ink sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-brand-gray">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: 'green' | 'gray' | 'amber';
}) {
  const bar =
    accent === 'green'
      ? 'bg-brand-green'
      : accent === 'amber'
        ? 'bg-status-progress'
        : 'bg-brand-gray';
  return (
    <div className="card relative overflow-hidden p-5">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{label}</p>
      <p className="mt-2 text-2xl font-bold text-brand-ink sm:text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-brand-gray">{hint}</p>}
    </div>
  );
}

const PROJECT_BADGE: Record<ProjectStatus, string> = {
  not_started: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-amber-100 text-amber-800',
  completed: 'bg-brand-green/20 text-brand-green-dark',
};
const PROJECT_DOT: Record<ProjectStatus, string> = {
  not_started: 'bg-gray-400',
  in_progress: 'bg-status-progress',
  completed: 'bg-brand-green',
};
const PROJECT_LABEL: Record<ProjectStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`badge ${PROJECT_BADGE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${PROJECT_DOT[status]}`} />
      {PROJECT_LABEL[status]}
    </span>
  );
}

const QUOTE_BADGE: Record<QuoteStatus, string> = {
  open: 'bg-blue-100 text-blue-800',
  sold: 'bg-brand-green/20 text-brand-green-dark',
  lost: 'bg-gray-100 text-gray-500',
};

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`badge ${QUOTE_BADGE[status]}`}>{label}</span>;
}

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
      <div className="h-full rounded-full bg-brand-green transition-all" style={{ width: `${v}%` }} />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-1 p-10 text-center">
      <p className="font-semibold text-brand-ink">{title}</p>
      {hint && <p className="text-sm text-brand-gray">{hint}</p>}
    </div>
  );
}
