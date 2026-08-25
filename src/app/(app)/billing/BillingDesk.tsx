'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { Project, ProjectInvoiceWithFile } from '@/lib/types';
import { money, shortDate } from '@/lib/format';
import {
  billingVariance,
  contractLocked,
  BILLING_STAGE_LABELS,
  type BillingSummary,
} from '@/lib/billing';
import { BillingStageBadge } from '@/components/ui';
import { ContractValueControl } from '@/components/billing/ContractValueControl';
import { BillingStageControls } from '@/components/billing/BillingStageControls';
import { InvoiceSection } from '@/components/billing/InvoiceSection';
import { listJobInvoicesAction } from '@/app/actions/billing';

/**
 * The billing desk's list of jobs — a queue you can work *in*, not one that
 * hands you off somewhere else.
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

export function BillingDesk({ rows }: { rows: DeskRow[] }) {
  /** Which job is open. One at a time — this is a work queue, not a report. */
  const [openId, setOpenId] = useState<number | null>(null);
  const [ledgers, setLedgers] = useState<Record<number, ProjectInvoiceWithFile[]>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <BillingDeskRow
          key={row.project.id}
          row={row}
          open={openId === row.project.id}
          loading={loadingId === row.project.id}
          error={openId === row.project.id ? loadError : null}
          invoices={ledgers[row.project.id]}
          onToggle={() => toggle(row.project.id)}
          onChanged={() => void load(row.project.id)}
        />
      ))}
    </div>
  );
}

/**
 * One job on the desk. Collapsed, the row leads with the stage and the age,
 * because the question this page answers is "which job next" — the money is
 * what you check once you've picked one. Opened, it *is* the job's billing.
 */
function BillingDeskRow({
  row,
  open,
  loading,
  error,
  invoices,
  onToggle,
  onChanged,
}: {
  row: DeskRow;
  open: boolean;
  loading: boolean;
  error: string | null;
  invoices: ProjectInvoiceWithFile[] | undefined;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const { project: p, summary: s } = row;
  const variance = billingVariance(s);
  const panelId = `billing-job-${p.id}`;
  const age =
    s.ageDays == null
      ? null
      : s.ageDays === 0
        ? 'completed today'
        : `${s.ageDays}d since completion`;

  return (
    <div
      className={`card overflow-hidden ${open ? 'border-brand-green/60 shadow-card-hover' : ''}`}
    >
      {/* The whole header is clickable for the mouse, and the chevron is the
          real control — focusable, labelled, and what a keyboard or a screen
          reader uses. A row of figures is not phrasing content, so it can't
          live inside the button itself. */}
      <div
        onClick={onToggle}
        className="cursor-pointer p-4 transition-colors duration-150 hover:bg-black/[0.015]"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 lg:flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="eyebrow truncate">{p.customer}</p>
              <BillingStageBadge stage={s.stage} urgency={s.urgency} />
            </div>
            <h3 className="brand-heading mt-1 truncate text-brand-ink">{p.name}</h3>
            <p className="tnum mt-1 text-xs text-brand-gray">
              {age && (
                <span className={s.urgency === 'late' ? 'font-semibold text-red-600' : undefined}>
                  {age}
                </span>
              )}
              {p.completed_at && <span> · completed {shortDate(p.completed_at)}</span>}
              {row.hours > 0 && <span> · {row.hours.toFixed(1)}h logged</span>}
              {s.count > 0 && (
                <span>
                  {' '}
                  · {s.count} {s.count === 1 ? 'invoice' : 'invoices'}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3 lg:shrink-0">
            <dl className="tnum grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5 lg:text-right">
              <Cell label="Contract" value={money(s.contract)} />
              <Cell label="Invoiced" value={money(s.invoiced)} />
              <Cell
                label="Left to Bill"
                value={money(Math.max(0, s.leftToBill))}
                alert={s.leftToBill > 0 && s.stage !== 'closed'}
              />
              <Cell label="Paid" value={money(s.paid)} />
              <Cell
                label="Outstanding"
                value={money(s.outstanding)}
                alert={s.outstanding > 0 && s.stage !== 'closed'}
              />
            </dl>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              aria-label={`${open ? 'Close' : 'Edit'} billing for ${p.name} — ${
                BILLING_STAGE_LABELS[s.stage]
              }`}
              className="btn-ghost shrink-0 rounded-full p-1.5"
              onClick={(e) => {
                // The header behind it already toggles; without this the click
                // would count twice and the row would snap shut again.
                e.stopPropagation();
                onToggle();
              }}
            >
              <ChevronDownIcon open={open} />
            </button>
          </div>
        </div>

        {(row.holdReason || variance || s.unbilled > 0) && !open && (
          <div className="mt-3 space-y-1 border-t border-surface-line pt-2 text-xs">
            {s.stage === 'on_hold' && row.holdReason && (
              <p className="text-brand-gray-dark">
                <span className="font-semibold">On hold — </span>
                {row.holdReason}
              </p>
            )}
            {s.unbilled > 0 && (
              <p className="text-amber-700">
                {money(s.unbilled)} raised on an invoice that hasn&apos;t gone out yet.
              </p>
            )}
            {variance === 'short' && (
              <p className="text-amber-700">
                {money(s.uninvoiced)} of the contract has no invoice against it.
              </p>
            )}
            {variance === 'over' && (
              <p className="text-amber-700">
                Invoiced {money(-s.uninvoiced)} over contract — check for a change order.
              </p>
            )}
          </div>
        )}
      </div>

      {open && (
        <div id={panelId} className="border-t border-surface-line bg-black/[0.015] p-4">
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
              screen, so they're stated here instead of on the collapsed row. */}
          {(s.unbilled > 0 || variance) && (
            <div className="mt-3 space-y-1 text-xs">
              {s.unbilled > 0 && (
                <p className="text-amber-700">
                  {money(s.unbilled, { cents: true })} is on an invoice that hasn&apos;t gone out
                  yet — tick <strong>Sent</strong> on it once it does.
                </p>
              )}
              {variance === 'short' && (
                <p className="text-amber-700">
                  {money(s.uninvoiced, { cents: true })} of the contract has no invoice against it.
                </p>
              )}
              {variance === 'over' && (
                <p className="text-amber-700">
                  Invoiced {money(-s.uninvoiced, { cents: true })} over contract — worth checking
                  against a change order.
                </p>
              )}
            </div>
          )}

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
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-brand-gray">
        {label}
      </dt>
      <dd className={`text-sm font-semibold ${alert ? 'text-amber-700' : 'text-brand-ink'}`}>
        {value}
      </dd>
    </div>
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
