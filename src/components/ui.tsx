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
    <div className="mb-6 flex flex-col gap-3 border-b border-surface-line pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="brand-heading text-2xl text-brand-ink sm:text-[1.75rem]">{title}</h1>
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
  // The accent reads as a small dot beside the label rather than a full-height
  // bar down the card edge — same information, far less ink.
  const dot =
    accent === 'green'
      ? 'bg-brand-green'
      : accent === 'amber'
        ? 'bg-status-progress'
        : 'bg-brand-gray/50';
  return (
    <div className="card p-5">
      <p className="eyebrow flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate">{label}</span>
      </p>
      <p className="brand-heading tnum mt-2.5 text-2xl text-brand-ink sm:text-[1.75rem]">{value}</p>
      {hint && <p className="mt-1 text-xs text-brand-gray">{hint}</p>}
    </div>
  );
}

const PROJECT_BADGE: Record<ProjectStatus, string> = {
  not_started: 'bg-brand-gray/10 text-brand-gray-dark',
  in_progress: 'bg-status-progress/15 text-amber-800',
  completed: 'bg-brand-green/15 text-brand-green-dark',
};
const PROJECT_DOT: Record<ProjectStatus, string> = {
  not_started: 'bg-brand-gray',
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
  open: 'bg-blue-500/10 text-blue-700',
  sold: 'bg-brand-green/15 text-brand-green-dark',
  lost: 'bg-brand-gray/10 text-brand-gray',
};
const QUOTE_DOT: Record<QuoteStatus, string> = {
  open: 'bg-blue-500',
  sold: 'bg-brand-green',
  lost: 'bg-brand-gray',
};

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`badge ${QUOTE_BADGE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${QUOTE_DOT[status]}`} />
      {label}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
      <div
        // Only `width` transitions — `transition-all` would also animate colour
        // and layout properties nobody asked for.
        className="h-full rounded-full bg-brand-green transition-[width] duration-500 ease-out"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-surface-line-strong bg-white/50 p-12 text-center">
      <p className="font-semibold text-brand-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm text-brand-gray">{hint}</p>}
    </div>
  );
}
