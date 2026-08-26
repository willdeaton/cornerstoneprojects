'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectStatus } from '@/lib/types';
import {
  BILLING_STAGE_LABELS,
  type BillingStage,
  type BillingUrgency,
} from '@/lib/billing';
import { money, shortDate } from '@/lib/format';
import {
  BillingStageBadge,
  EmptyState,
  OnHoldBadge,
  ProgressBar,
  ProjectStatusBadge,
} from '@/components/ui';
import { readListFilters, writeListFilters } from '@/lib/list-state';

/**
 * One job as the list reads it: the project row, its logged hours, and where
 * it stands on billing when the viewer is allowed to see that. Flattened on
 * the server so the whole table is one serialisable array.
 */
export interface ProjectRow {
  id: number;
  customer: string;
  name: string;
  quote_number: string | null;
  category: string | null;
  location: string | null;
  value: number;
  status: ProjectStatus;
  progress: number;
  due_date: string | null;
  on_hold: boolean;
  on_hold_reason: string | null;
  on_hold_since: string | null;
  hours: number;
  /** Null for roles that don't see billing at all. */
  billing: { stage: BillingStage; urgency: BillingUrgency; outstanding: number } | null;
}

type SortKey =
  | 'customer'
  | 'name'
  | 'status'
  | 'progress'
  | 'billing'
  | 'due_date'
  | 'hours'
  | 'value';
type SortDir = 'asc' | 'desc';

const COLUMNS: {
  key: SortKey;
  label: string;
  align?: 'right';
  billing?: true;
  /** Held wide enough that a long name wraps to two lines, not five. */
  width?: string;
}[] = [
  { key: 'customer', label: 'Customer', width: 'min-w-[9.5rem]' },
  { key: 'name', label: 'Job' },
  { key: 'status', label: 'Status' },
  { key: 'progress', label: 'Progress' },
  { key: 'billing', label: 'Billing', billing: true },
  { key: 'due_date', label: 'Due' },
  { key: 'hours', label: 'Hours', align: 'right' },
  { key: 'value', label: 'Value', align: 'right' },
];

const STATUS_ORDER: Record<ProjectStatus, number> = {
  not_started: 0,
  in_progress: 1,
  completed: 2,
};

/** Billing sorts along the pipeline, not alphabetically. */
const STAGE_ORDER: Record<BillingStage, number> = {
  not_ready: 0,
  ready_to_bill: 1,
  invoiced: 2,
  on_hold: 3,
  paid: 4,
  closed: 5,
};

/** Filters worth picking back up when the user returns from a job. */
type SavedFilters = {
  search: string;
  category: string;
  stage: string;
  hold: string;
  sortKey: SortKey;
  sortDir: SortDir;
};

const HOLD_OPTIONS = [
  { key: 'all', label: 'Any hold status' },
  { key: 'on', label: 'On hold only' },
  { key: 'off', label: 'Not on hold' },
];

function isSortKey(v: unknown): v is SortKey {
  return COLUMNS.some((c) => c.key === v);
}

/** Whole days a due date is past, or null when it isn't. */
function daysLate(due: string | null, status: ProjectStatus): number | null {
  if (!due || status === 'completed') return null;
  const d = Date.parse(due.includes('T') ? due : due + 'T00:00:00');
  if (Number.isNaN(d)) return null;
  const days = Math.floor((Date.now() - d) / 864e5);
  return days > 0 ? days : null;
}

function text(a: string | null, b: string | null): number {
  // Empties sort last whichever way the column is pointing.
  const av = a ?? '';
  const bv = b ?? '';
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
}

function compare(a: ProjectRow, b: ProjectRow, key: SortKey): number {
  switch (key) {
    case 'value':
      return a.value - b.value;
    case 'hours':
      return a.hours - b.hours;
    case 'progress':
      return a.progress - b.progress;
    case 'status':
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case 'billing': {
      // A job with no billing to speak of sits below every job that has some.
      const av = a.billing ? STAGE_ORDER[a.billing.stage] : -1;
      const bv = b.billing ? STAGE_ORDER[b.billing.stage] : -1;
      return av - bv;
    }
    case 'due_date': {
      // Chronological; a job with no due date sorts last either way.
      const av = a.due_date ? Date.parse(a.due_date) : NaN;
      const bv = b.due_date ? Date.parse(b.due_date) : NaN;
      const an = Number.isNaN(av);
      const bn = Number.isNaN(bv);
      if (an && bn) return 0;
      if (an) return 1;
      if (bn) return -1;
      return av - bv;
    }
    default:
      return text(a[key], b[key]);
  }
}

export function ProjectsTable({ rows, canBill }: { rows: ProjectRow[]; canBill: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [stage, setStage] = useState('all');
  const [hold, setHold] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Billing is an admin/manager concern, same as the Billing page itself, so
  // the column and its filter come and go with the viewer's role.
  const columns = useMemo(() => COLUMNS.filter((c) => !c.billing || canBill), [canBill]);

  const categories = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.category).filter((c): c is string => Boolean(c)))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [rows],
  );

  const stages = useMemo(() => {
    const present = new Set(rows.map((r) => r.billing?.stage).filter(Boolean) as BillingStage[]);
    return (Object.keys(STAGE_ORDER) as BillingStage[]).filter((s) => present.has(s));
  }, [rows]);

  // Search, filters and sort come back when the user returns from a job — the
  // status tab lives in the URL, this is the rest of the view. Restored after
  // mount rather than in the initial state so the server markup still matches.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = readListFilters<SavedFilters>('projects');
    if (saved) {
      if (typeof saved.search === 'string') setSearch(saved.search);
      if (typeof saved.category === 'string') setCategory(saved.category);
      if (typeof saved.stage === 'string') setStage(saved.stage);
      if (typeof saved.hold === 'string') setHold(saved.hold);
      if (isSortKey(saved.sortKey)) setSortKey(saved.sortKey);
      if (saved.sortDir === 'asc' || saved.sortDir === 'desc') setSortDir(saved.sortDir);
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    writeListFilters<SavedFilters>('projects', { search, category, stage, hold, sortKey, sortDir });
  }, [restored, search, category, stage, hold, sortKey, sortDir]);

  // A remembered filter this tab has no jobs for would otherwise blank the
  // table out with no obvious cause.
  const activeCategory = category !== 'all' && !categories.includes(category) ? 'all' : category;
  const activeStage =
    stage !== 'all' && !stages.includes(stage as BillingStage) ? 'all' : stage;
  const activeSortKey = sortKey === 'billing' && !canBill ? 'value' : sortKey;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeCategory !== 'all' && r.category !== activeCategory) return false;
      if (activeStage !== 'all' && r.billing?.stage !== activeStage) return false;
      if (hold === 'on' && !r.on_hold) return false;
      if (hold === 'off' && r.on_hold) return false;
      if (!q) return true;
      return [r.customer, r.name, r.quote_number, r.category, r.location]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, search, activeCategory, activeStage, hold]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const c = compare(a, b, activeSortKey);
      // Stable tiebreak by id so equal rows don't jump around.
      return c !== 0 ? c * dir : a.id - b.id;
    });
  }, [filtered, activeSortKey, sortDir]);

  const total = filtered.reduce((s, r) => s + r.value, 0);
  const outstanding = filtered.reduce((s, r) => s + (r.billing?.outstanding ?? 0), 0);
  const filtersOn =
    search.trim() !== '' || activeCategory !== 'all' || activeStage !== 'all' || hold !== 'all';

  function toggleSort(key: SortKey) {
    if (key === activeSortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Money, hours and progress read best highest-first; dates soonest-first;
      // text A→Z.
      setSortDir(key === 'value' || key === 'hours' || key === 'progress' ? 'desc' : 'asc');
    }
  }

  function clearFilters() {
    setSearch('');
    setCategory('all');
    setStage('all');
    setHold('all');
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="input sm:w-72"
          placeholder="Search customer, job, quote #, location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input sm:w-48"
          value={activeCategory}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {canBill && stages.length > 0 && (
          <select
            className="input sm:w-44"
            value={activeStage}
            onChange={(e) => setStage(e.target.value)}
            aria-label="Filter by billing stage"
          >
            <option value="all">All billing</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {BILLING_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        )}
        <select
          className="input sm:w-44"
          value={hold}
          onChange={(e) => setHold(e.target.value)}
          aria-label="Filter by hold"
        >
          {HOLD_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        {filtersOn && (
          <button
            type="button"
            onClick={clearFilters}
            className="px-1 text-sm font-semibold text-brand-gray transition-colors duration-150 hover:text-brand-ink"
          >
            Clear
          </button>
        )}
        <p className="tnum text-sm text-brand-gray sm:ml-auto">
          <span className="font-semibold text-brand-ink">{filtered.length}</span> jobs ·{' '}
          <span className="font-semibold text-brand-ink">{money(total)}</span>
          {canBill && outstanding > 0 && (
            <> · <span className="font-semibold text-brand-ink">{money(outstanding)}</span> outstanding</>
          )}
        </p>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? 'No projects here yet' : 'No jobs match'}
          hint={
            rows.length === 0
              ? 'Sell a quote from the Quotes tab, or add a project directly.'
              : 'Try a different search or filter.'
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <thead>
                <tr className="border-b border-surface-line text-left">
                  {columns.map((col) => {
                    const active = activeSortKey === col.key;
                    return (
                      <th
                        key={col.key}
                        aria-sort={
                          active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                        className={`eyebrow whitespace-nowrap px-3 py-2.5 ${
                          col.align === 'right' ? 'text-right' : ''
                        } ${col.width ?? ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className={`inline-flex items-center gap-1 transition-colors duration-150 hover:text-brand-ink ${
                            active ? 'text-brand-ink' : ''
                          } ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
                        >
                          {col.label}
                          {/* Only the sorted column carries an arrow — an
                              indicator on every column is just noise. */}
                          <span
                            aria-hidden
                            className={`text-[0.6rem] leading-none transition-opacity duration-150 ${
                              active ? 'opacity-100' : 'opacity-0'
                            }`}
                          >
                            {sortDir === 'asc' ? '▲' : '▼'}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const late = daysLate(r.due_date, r.status);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => router.push(`/projects/${r.id}`)}
                      className="cursor-pointer border-b border-surface-line transition-colors duration-100 last:border-0 hover:bg-black/[0.02]"
                    >
                      <td className="px-3 py-3 font-semibold text-brand-ink">{r.customer}</td>
                      <td className="max-w-[20rem] px-3 py-3">
                        <span className="block truncate text-brand-ink" title={r.name}>
                          {r.name}
                        </span>
                        {(r.quote_number || r.category || r.location) && (
                          <span className="mt-0.5 block truncate text-xs text-brand-gray">
                            {[r.quote_number, r.category, r.location].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <ProjectStatusBadge status={r.status} />
                          {r.on_hold && (
                            <OnHoldBadge reason={r.on_hold_reason} since={r.on_hold_since} />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16">
                            <ProgressBar value={r.progress} />
                          </div>
                          <span className="tnum text-xs text-brand-gray">{r.progress}%</span>
                        </div>
                      </td>
                      {canBill && (
                        <td className="px-3 py-3">
                          {r.billing ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <BillingStageBadge
                                stage={r.billing.stage}
                                urgency={r.billing.urgency}
                              />
                              {r.billing.outstanding > 0 && (
                                <span className="tnum whitespace-nowrap text-xs text-brand-gray">
                                  {money(r.billing.outstanding)} out
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-brand-gray">—</span>
                          )}
                        </td>
                      )}
                      <td
                        className={`tnum whitespace-nowrap px-3 py-3 ${
                          late ? 'font-semibold text-red-600' : 'text-brand-gray'
                        }`}
                        title={late ? `${late} day${late === 1 ? '' : 's'} past due` : undefined}
                      >
                        {shortDate(r.due_date)}
                      </td>
                      <td className="tnum whitespace-nowrap px-3 py-3 text-right text-brand-gray">
                        {r.hours > 0 ? `${r.hours.toFixed(1)}h` : '—'}
                      </td>
                      <td className="tnum whitespace-nowrap px-3 py-3 text-right font-semibold text-brand-ink">
                        {money(r.value)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
