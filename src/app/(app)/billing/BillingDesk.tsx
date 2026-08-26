'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Project, ProjectInvoiceWithFile } from '@/lib/types';
import { money, shortDate } from '@/lib/format';
import {
  awaitingPurchaseOrder,
  billingVariance,
  contractLocked,
  poOverrun,
  BILLING_STAGE_LABELS,
  type BillingStage,
  type BillingSummary,
} from '@/lib/billing';
import { BillingStageBadge, EmptyState } from '@/components/ui';
import { PrintMeta } from '@/components/print';
import { readListFilters, writeListFilters } from '@/lib/list-state';
import { ContractValueControl } from '@/components/billing/ContractValueControl';
import { BillingStageControls } from '@/components/billing/BillingStageControls';
import { InvoiceSection } from '@/components/billing/InvoiceSection';
import { PurchaseOrderCard } from '@/components/billing/PurchaseOrderCard';
import { listJobInvoicesAction } from '@/app/actions/billing';

/**
 * The billing desk's list of jobs — a queue you can work *in*, not one that
 * hands you off somewhere else.
 *
 * It reads as the Projects list reads, deliberately: the same sortable, dense
 * table with the same search and filters above it, because it is the same
 * question asked about the same jobs — a job's row should not change shape
 * depending on which page you found it on. What differs is the columns (the
 * money down the pipeline, and the age that says which job is next) and what a
 * row does when you click it.
 *
 * Opening a row brings the job's whole billing down into the page: its invoice
 * ledger, exactly the card the job's Billing tab shows, plus the stage
 * decisions and the mark-billed/mark-paid short path. So the ordinary day —
 * open the oldest job, tick what went out, mark what came in, move on — never
 * leaves this page, and the job page is still there for everything that isn't
 * billing.
 *
 * The ledger for a row is fetched when that row is opened rather than shipped
 * with the page: the desk is a queue of the jobs still moving, and it has no
 * business loading every invoice ever raised to draw itself.
 */

export interface DeskRow {
  project: Project;
  summary: BillingSummary;
  holdReason: string | null;
  closedByName: string | null;
  hours: number;
}

type SortKey =
  | 'customer'
  | 'name'
  | 'stage'
  | 'age'
  | 'contract'
  | 'invoiced'
  | 'leftToBill'
  | 'outstanding';
type SortDir = 'asc' | 'desc';

const COLUMNS: {
  key: SortKey;
  label: string;
  align?: 'right';
  /** Held wide enough that a long name wraps to two lines, not five. */
  width?: string;
}[] = [
  { key: 'customer', label: 'Customer', width: 'min-w-[9.5rem]' },
  { key: 'name', label: 'Job' },
  { key: 'stage', label: 'Billing' },
  { key: 'age', label: 'Age' },
  { key: 'contract', label: 'Contract', align: 'right' },
  { key: 'invoiced', label: 'Invoiced', align: 'right' },
  { key: 'leftToBill', label: 'Left to Bill', align: 'right' },
  { key: 'outstanding', label: 'Outstanding', align: 'right' },
];

/** Billing sorts along the pipeline, not alphabetically. */
const STAGE_ORDER: Record<BillingStage, number> = {
  not_ready: 0,
  ready_to_bill: 1,
  invoiced: 2,
  on_hold: 3,
  paid: 4,
  closed: 5,
};

/**
 * What a row is waiting on, beyond its stage — the things that stop an invoice
 * going out or say the figures don't add up. Filterable, because "show me the
 * jobs I can't bill yet" and "show me the jobs to chase" are the two passes
 * somebody actually makes down this desk.
 */
const ATTENTION_OPTIONS = [
  { key: 'all', label: 'Anything' },
  { key: 'chasing', label: 'Needs chasing' },
  { key: 'paperwork', label: 'Missing paperwork' },
  { key: 'variance', label: 'Figures disagree' },
];

/** Filters worth picking back up when the user returns from a job. */
type SavedFilters = {
  search: string;
  category: string;
  stage: string;
  attention: string;
  sortKey: SortKey;
  sortDir: SortDir;
};

function isSortKey(v: unknown): v is SortKey {
  return COLUMNS.some((c) => c.key === v);
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

function compare(a: DeskRow, b: DeskRow, key: SortKey): number {
  switch (key) {
    case 'customer':
      return text(a.project.customer, b.project.customer);
    case 'name':
      return text(a.project.name, b.project.name);
    case 'stage':
      return STAGE_ORDER[a.summary.stage] - STAGE_ORDER[b.summary.stage];
    case 'age': {
      // A job still running has no age; it sorts last either way.
      const av = a.summary.ageDays;
      const bv = b.summary.ageDays;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv;
    }
    case 'contract':
      return a.summary.contract - b.summary.contract;
    case 'invoiced':
      return a.summary.invoiced - b.summary.invoiced;
    case 'leftToBill':
      return Math.max(0, a.summary.leftToBill) - Math.max(0, b.summary.leftToBill);
    case 'outstanding':
      return a.summary.outstanding - b.summary.outstanding;
  }
}

/** The flags a row carries, stated once so the row, the filter and the printout agree. */
function flags(row: DeskRow) {
  const { project: p, summary: s } = row;
  return {
    needsPo: awaitingPurchaseOrder(s.stage, p),
    poOver: poOverrun(p, s.invoiced),
    variance: billingVariance(s),
    unbilled: s.unbilled > 0,
    chasing: s.urgency === 'late' || s.urgency === 'watch',
  };
}

export function BillingDesk({
  rows,
  /** Which pipeline tab this is — screen chrome, so the printout says it in words. */
  tabLabel,
}: {
  rows: DeskRow[];
  tabLabel?: string;
}) {
  /** Which job is open. One at a time — this is a work queue, not a report. */
  const [openId, setOpenId] = useState<number | null>(null);
  const [ledgers, setLedgers] = useState<Record<number, ProjectInvoiceWithFile[]>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [stage, setStage] = useState('all');
  const [attention, setAttention] = useState('all');
  // The desk's own question is "which job next", so it opens on the oldest.
  const [sortKey, setSortKey] = useState<SortKey>('age');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const load = useCallback(async (projectId: number) => {
    setLoadingId(projectId);
    setLoadError(null);
    try {
      const invoices = await listJobInvoicesAction(projectId);
      setLedgers((prev) => ({ ...prev, [projectId]: invoices }));
    } catch {
      setLoadError("Couldn't load this job's invoices. Try opening it again.");
    } finally {
      setLoadingId(null);
    }
  }, []);

  function toggle(projectId: number) {
    if (openId === projectId) {
      setOpenId(null);
      return;
    }
    setOpenId(projectId);
    setLoadError(null);
    // Re-fetch on every open: the numbers on the row came from the server, and
    // a ledger cached from an earlier open could be a save behind them.
    void load(projectId);
  }

  const categories = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.project.category).filter((c): c is string => Boolean(c)))
      ).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  // Only the "All" tab carries more than one stage; elsewhere the filter would
  // be a control with one setting.
  const stages = useMemo(() => {
    const present = new Set(rows.map((r) => r.summary.stage));
    return (Object.keys(STAGE_ORDER) as BillingStage[]).filter((s) => present.has(s));
  }, [rows]);

  // Search, filters and sort come back when the user returns from a job — the
  // pipeline tab lives in the URL, this is the rest of the view. Restored after
  // mount rather than in the initial state so the server markup still matches.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = readListFilters<SavedFilters>('billing');
    if (saved) {
      if (typeof saved.search === 'string') setSearch(saved.search);
      if (typeof saved.category === 'string') setCategory(saved.category);
      if (typeof saved.stage === 'string') setStage(saved.stage);
      if (typeof saved.attention === 'string') setAttention(saved.attention);
      if (isSortKey(saved.sortKey)) setSortKey(saved.sortKey);
      if (saved.sortDir === 'asc' || saved.sortDir === 'desc') setSortDir(saved.sortDir);
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    writeListFilters<SavedFilters>('billing', {
      search,
      category,
      stage,
      attention,
      sortKey,
      sortDir,
    });
  }, [restored, search, category, stage, attention, sortKey, sortDir]);

  // A remembered filter this tab has no jobs for would otherwise blank the
  // table out with no obvious cause.
  const activeCategory = category !== 'all' && !categories.includes(category) ? 'all' : category;
  const activeStage = stage !== 'all' && !stages.includes(stage as BillingStage) ? 'all' : stage;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const p = r.project;
      if (activeCategory !== 'all' && p.category !== activeCategory) return false;
      if (activeStage !== 'all' && r.summary.stage !== activeStage) return false;
      if (attention !== 'all') {
        const f = flags(r);
        if (attention === 'chasing' && !f.chasing) return false;
        if (attention === 'paperwork' && !f.needsPo && f.poOver == null) return false;
        if (attention === 'variance' && !f.variance && !f.unbilled) return false;
      }
      if (!q) return true;
      return [p.customer, p.name, p.quote_number, p.category, p.location, p.po_number]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, search, activeCategory, activeStage, attention]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const c = compare(a, b, sortKey);
      // Stable tiebreak by id so equal rows don't jump around.
      return c !== 0 ? c * dir : a.project.id - b.project.id;
    });
  }, [filtered, sortKey, sortDir]);

  const contract = filtered.reduce((t, r) => t + r.summary.contract, 0);
  const outstanding = filtered.reduce((t, r) => t + r.summary.outstanding, 0);
  const leftToBill = filtered.reduce((t, r) => t + Math.max(0, r.summary.leftToBill), 0);
  const filtersOn =
    search.trim() !== '' || activeCategory !== 'all' || activeStage !== 'all' || attention !== 'all';

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Money and age read best highest-first — the biggest bill and the
      // longest wait are what this desk is looking for; text A→Z.
      setSortDir(key === 'customer' || key === 'name' || key === 'stage' ? 'asc' : 'desc');
    }
  }

  function clearFilters() {
    setSearch('');
    setCategory('all');
    setStage('all');
    setAttention('all');
  }

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="input sm:w-72"
          placeholder="Search customer, job, quote #, PO #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {categories.length > 0 && (
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
        )}
        {stages.length > 1 && (
          <select
            className="input sm:w-44"
            value={activeStage}
            onChange={(e) => setStage(e.target.value)}
            aria-label="Filter by billing stage"
          >
            <option value="all">All stages</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {BILLING_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        )}
        <select
          className="input sm:w-48"
          value={attention}
          onChange={(e) => setAttention(e.target.value)}
          aria-label="Filter by what a job is waiting on"
        >
          {ATTENTION_OPTIONS.map((o) => (
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
          <span className="font-semibold text-brand-ink">{filtered.length}</span>{' '}
          {filtered.length === 1 ? 'job' : 'jobs'} ·{' '}
          <span className="font-semibold text-brand-ink">{money(contract)}</span> contract
          {outstanding > 0 && (
            <>
              {' '}
              · <span className="font-semibold text-brand-ink">{money(outstanding)}</span>{' '}
              outstanding
            </>
          )}
        </p>
      </div>

      <PrintMeta
        meta={[
          tabLabel,
          `${filtered.length} ${filtered.length === 1 ? 'job' : 'jobs'}`,
          `${money(contract)} contract`,
          leftToBill > 0 && `${money(leftToBill)} left to bill`,
          outstanding > 0 && `${money(outstanding)} outstanding`,
          search.trim() !== '' && `search "${search.trim()}"`,
          activeCategory !== 'all' && activeCategory,
          activeStage !== 'all' && BILLING_STAGE_LABELS[activeStage as BillingStage],
          attention !== 'all' && ATTENTION_OPTIONS.find((o) => o.key === attention)?.label,
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState title="No jobs match" hint="Try a different search or filter." />
      ) : (
        <div className="card overflow-hidden">
          <div className="print-wrap overflow-x-auto">
            <table className="print-table w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-surface-line text-left">
                  {COLUMNS.map((col) => {
                    const active = sortKey === col.key;
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
                            className={`no-print text-[0.6rem] leading-none transition-opacity duration-150 ${
                              active ? 'opacity-100' : 'opacity-0'
                            }`}
                          >
                            {sortDir === 'asc' ? '▲' : '▼'}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                  {/* The disclosure column: a control, so it has no label and
                      never prints. */}
                  <th className="no-print w-10 px-3 py-2.5">
                    <span className="sr-only">Bill this job</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <BillingDeskRow
                    key={row.project.id}
                    row={row}
                    columnCount={COLUMNS.length + 1}
                    open={openId === row.project.id}
                    loading={loadingId === row.project.id}
                    error={openId === row.project.id ? loadError : null}
                    invoices={ledgers[row.project.id]}
                    onToggle={() => toggle(row.project.id)}
                    onChanged={() => void load(row.project.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One job on the desk: the row, and — when it's open — the job's billing
 * itself, in a panel spanning the table underneath it.
 *
 * The row leads with the stage and the age, because the question this page
 * answers is "which job next"; the money is what you check once you've picked
 * one, so it runs down the right-hand columns where a column of figures can be
 * read against the job above and below it.
 */
function BillingDeskRow({
  row,
  columnCount,
  open,
  loading,
  error,
  invoices,
  onToggle,
  onChanged,
}: {
  row: DeskRow;
  columnCount: number;
  open: boolean;
  loading: boolean;
  error: string | null;
  invoices: ProjectInvoiceWithFile[] | undefined;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const { project: p, summary: s } = row;
  const f = flags(row);
  const panelId = `billing-job-${p.id}`;
  const meta = [p.quote_number, p.category, p.location, row.hours > 0 ? `${row.hours.toFixed(1)}h` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-surface-line transition-colors duration-100 hover:bg-black/[0.02] ${
          open ? 'bg-black/[0.02]' : 'last:border-0'
        }`}
      >
        <td className="px-3 py-3 font-semibold text-brand-ink">{p.customer}</td>
        <td className="max-w-[20rem] px-3 py-3">
          <span className="block truncate text-brand-ink" title={p.name}>
            {p.name}
          </span>
          {meta && <span className="mt-0.5 block truncate text-xs text-brand-gray">{meta}</span>}
        </td>
        <td className="px-3 py-3">
          <BillingStageBadge stage={s.stage} urgency={s.urgency} />
          {/* What the row is waiting on, in the cell that says where it is.
              One line, cheapest-to-fix first: the hold reason if somebody
              parked it, then the paperwork, then the figures. */}
          <RowFlags row={row} flags={f} />
        </td>
        <td
          className={`tnum whitespace-nowrap px-3 py-3 ${
            s.urgency === 'late' ? 'font-semibold text-red-600' : 'text-brand-gray'
          }`}
          title={
            s.ageDays == null
              ? 'Still running — nothing to age yet'
              : `${s.ageDays} day${s.ageDays === 1 ? '' : 's'} since completion`
          }
        >
          {s.ageDays == null ? '—' : s.ageDays === 0 ? 'today' : `${s.ageDays}d`}
          {p.completed_at && (
            <span className="mt-0.5 block text-xs font-normal text-brand-gray">
              {shortDate(p.completed_at)}
            </span>
          )}
        </td>
        <td className="tnum whitespace-nowrap px-3 py-3 text-right text-brand-gray">
          {money(s.contract)}
        </td>
        <td className="tnum whitespace-nowrap px-3 py-3 text-right text-brand-gray">
          {money(s.invoiced)}
          {s.count > 0 && (
            <span className="mt-0.5 block text-xs text-brand-gray">
              {s.count} {s.count === 1 ? 'invoice' : 'invoices'}
            </span>
          )}
        </td>
        <td
          className={`tnum whitespace-nowrap px-3 py-3 text-right ${
            s.leftToBill > 0 && s.stage !== 'closed'
              ? 'font-semibold text-amber-700'
              : 'text-brand-gray'
          }`}
        >
          {money(Math.max(0, s.leftToBill))}
        </td>
        <td
          className={`tnum whitespace-nowrap px-3 py-3 text-right ${
            s.outstanding > 0 && s.stage !== 'closed'
              ? 'font-semibold text-brand-ink'
              : 'text-brand-gray'
          }`}
        >
          {money(s.outstanding)}
        </td>
        {/* The row behind it already toggles for the mouse; this is the real
            control — focusable, labelled, and what a keyboard or a screen
            reader uses. */}
        <td className="no-print px-3 py-3 text-right">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? 'Close' : 'Edit'} billing for ${p.name} — ${
              BILLING_STAGE_LABELS[s.stage]
            }`}
            className="btn-ghost rounded-full p-1.5"
            onClick={(e) => {
              // Without this the click would count twice and the row would
              // snap shut again.
              e.stopPropagation();
              onToggle();
            }}
          >
            <ChevronDownIcon open={open} />
          </button>
        </td>
      </tr>

      {open && (
        // Editing controls are a screen thing: a printout of the desk is the
        // table, not whichever job happened to be open when it was printed.
        <tr className="no-print border-b border-surface-line last:border-0">
          <td colSpan={columnCount} className="bg-black/[0.015] p-4" id={panelId}>
            <BillingStageControls
              projectId={p.id}
              summary={s}
              holdReason={row.holdReason}
              closedAt={p.billing_closed_at}
              closedByName={row.closedByName}
              onChanged={onChanged}
            />

            {/* The desk is where an over-billed job gets noticed, so it is also
                where the change order that explains it gets recorded. */}
            <div className="mt-3">
              <ContractValueControl
                projectId={p.id}
                projectName={p.name}
                locked={contractLocked(s.stage)}
                onChanged={onChanged}
              />
            </div>

            {/* The variances belong with the ledger they're about once it's on
                screen, stated to the cent here rather than rounded as on the row. */}
            {(f.unbilled || f.variance) && (
              <div className="mt-3 space-y-1 text-xs">
                {f.unbilled && (
                  <p className="text-amber-700">
                    {money(s.unbilled, { cents: true })} is on an invoice that hasn&apos;t gone out
                    yet — tick <strong>Sent</strong> on it once it does.
                  </p>
                )}
                {f.variance === 'short' && (
                  <p className="text-amber-700">
                    {money(s.uninvoiced, { cents: true })} of the contract has no invoice against
                    it.
                  </p>
                )}
                {f.variance === 'over' && (
                  <p className="text-amber-700">
                    Invoiced {money(-s.uninvoiced, { cents: true })} over contract — worth checking
                    against a change order.
                  </p>
                )}
              </div>
            )}

            {/* The PO belongs above the ledger, because that is the order it
                happens in: it is on file first, and every invoice raised below
                starts out billed against it. */}
            <div className="mt-4 border-t border-surface-line pt-4">
              <PurchaseOrderCard
                project={p}
                invoiced={s.invoiced}
                stage={s.stage}
                variant="inline"
                onChanged={onChanged}
              />
            </div>

            <div className="mt-4 border-t border-surface-line pt-4">
              {error ? (
                <p className="text-sm font-medium text-red-600">{error}</p>
              ) : invoices ? (
                <InvoiceSection
                  project={p}
                  invoices={invoices}
                  variant="inline"
                  onSaved={onChanged}
                />
              ) : (
                <p className="py-3 text-sm text-brand-gray">
                  {loading ? 'Loading the invoices…' : 'Opening…'}
                </p>
              )}
            </div>

            <div className="mt-4 border-t border-surface-line pt-3">
              <Link
                href={`/projects/${p.id}`}
                className="text-xs font-semibold text-brand-green-dark hover:underline"
              >
                Open the job for everything else →
              </Link>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The one thing about a row that isn't a figure or a stage: what it's waiting
 * on. A finished job with no PO on file isn't waiting on somebody to raise the
 * invoice — it's waiting on the paperwork that lets the invoice go out, which
 * is a different job for a different person, so the row says which it is.
 */
function RowFlags({ row, flags: f }: { row: DeskRow; flags: ReturnType<typeof flags> }) {
  const { project: p, summary: s } = row;
  const notes: string[] = [];

  if (s.stage === 'on_hold' && row.holdReason) notes.push(`On hold — ${row.holdReason}`);
  if (f.needsPo) notes.push('No customer PO on file');
  if (f.poOver != null) notes.push(`${money(f.poOver)} over PO ${p.po_number}`);
  if (f.unbilled) notes.push(`${money(s.unbilled)} raised, not sent`);
  if (f.variance === 'short') notes.push(`${money(s.uninvoiced)} uninvoiced`);
  if (f.variance === 'over') notes.push(`${money(-s.uninvoiced)} over contract`);

  if (notes.length === 0) return null;
  return (
    <span
      className="mt-1 block max-w-[16rem] truncate text-xs text-amber-700"
      title={notes.join(' · ')}
    >
      {notes.join(' · ')}
    </span>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
