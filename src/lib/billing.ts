import type { Project, ProjectInvoice } from './types';

/**
 * The billing pipeline — where a job stands between "the work is finished" and
 * "the money is in".
 *
 * The stage is DERIVED, never stored. It falls out of three things that are
 * already true: the project's status, its invoice rows' billed/paid flags, and
 * the two deliberate acts the invoices can't express — parking a job's billing
 * (a hold) and signing it off (a close-out). So there is nothing to keep in
 * step: tick an invoice Paid on the project and it leaves the outstanding
 * queue by itself.
 *
 * This module is pure and imports no server code, so the queue page, the
 * project card and the client-side controls all read the same rules.
 */

export type BillingStage =
  /** The work isn't finished, so there is nothing to bill yet. */
  | 'not_ready'
  /** Job complete, nothing has gone out to the customer. This is the queue. */
  | 'ready_to_bill'
  /** At least one invoice has gone out; money is still owed. */
  | 'invoiced'
  /** Every invoice raised has been paid. */
  | 'paid'
  /** Deliberately parked, with a reason — a dispute, a retainage hold, a
   *  customer waiting on paperwork. Stays out of the "late" counts. */
  | 'on_hold'
  /** Signed off and off the billing desk, whatever the invoices say. */
  | 'closed';

export const BILLING_STAGE_LABELS: Record<BillingStage, string> = {
  not_ready: 'Not Ready',
  ready_to_bill: 'Ready to Bill',
  invoiced: 'Invoiced',
  paid: 'Paid',
  on_hold: 'On Hold',
  closed: 'Closed',
};

/**
 * How long a stage may sit before it's worth chasing, in days since the job
 * completed. Billing that hasn't gone out is measured in days; an invoice
 * that's out is measured against normal net-30 terms.
 */
export const BILLING_SLA = {
  ready_to_bill: { watch: 7, late: 14 },
  invoiced: { watch: 30, late: 45 },
} as const;

/** Whether a stage is late enough to want attention. */
export type BillingUrgency = 'none' | 'watch' | 'late';

/**
 * The invoice rows of one job, reduced to the numbers the pipeline needs.
 * Built either from the rows themselves (the project page) or straight out of
 * a grouped query (the billing queue), so both paths reach the same shape.
 */
export interface InvoiceTally {
  count: number;
  /** Rows that have gone out to the customer. */
  billedCount: number;
  /** Rows the money has landed for. */
  paidCount: number;
  /** Value of every row raised, sent or not. */
  invoiced: number;
  /** Value of the rows that have gone out. */
  billed: number;
  /** Value of the rows that have been paid. */
  paid: number;
}

export const EMPTY_TALLY: InvoiceTally = {
  count: 0,
  billedCount: 0,
  paidCount: 0,
  invoiced: 0,
  billed: 0,
  paid: 0,
};

type InvoiceLike = Pick<ProjectInvoice, 'amount' | 'billed' | 'paid'>;

export function tallyInvoices(rows: InvoiceLike[]): InvoiceTally {
  return rows.reduce<InvoiceTally>(
    (t, r) => ({
      count: t.count + 1,
      // Paid implies billed — the invoice card keeps the flags in step, and
      // reading it that way here means a stray row can't hide from the totals.
      billedCount: t.billedCount + (r.billed || r.paid ? 1 : 0),
      paidCount: t.paidCount + (r.paid ? 1 : 0),
      invoiced: t.invoiced + r.amount,
      billed: t.billed + (r.billed || r.paid ? r.amount : 0),
      paid: t.paid + (r.paid ? r.amount : 0),
    }),
    EMPTY_TALLY
  );
}

/** The project fields the pipeline reads — so callers can pass a partial row. */
export type BillableProject = Pick<
  Project,
  'value' | 'status' | 'completed_at' | 'billing_hold' | 'billing_closed_at'
>;

/**
 * Which stage a job is at. Order matters: a closed job is closed however its
 * invoices read; a fully paid one is paid even if somebody left a hold on it;
 * and a job invoiced part-way through the work is already in the pipeline
 * before it's marked complete, which is exactly how progress billing works.
 */
export function billingStage(p: BillableProject, tally: InvoiceTally): BillingStage {
  if (p.billing_closed_at) return 'closed';
  if (tally.count > 0 && tally.paidCount === tally.count) return 'paid';
  if (p.billing_hold) return 'on_hold';
  if (tally.billedCount > 0) return 'invoiced';
  if (p.status === 'completed') return 'ready_to_bill';
  return 'not_ready';
}

export interface BillingSummary extends InvoiceTally {
  stage: BillingStage;
  /** The job's contract value, for the variance against what's been raised. */
  contract: number;
  /** Billed and not yet paid — this job's share of the A/R. */
  outstanding: number;
  /** Raised on an invoice that hasn't gone out yet. */
  unbilled: number;
  /** Contract value no invoice covers yet; negative when over-billed. */
  uninvoiced: number;
  /** Days since the job completed, or null while it's still running. */
  ageDays: number | null;
  urgency: BillingUrgency;
}

/** Whole days between a timestamp and now, floored, never negative. */
export function daysSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / 864e5));
}

/**
 * How overdue a stage is. Only the two working stages age — a paid, closed or
 * held job isn't waiting on anybody, and an unfinished one isn't billable yet.
 */
export function billingUrgency(stage: BillingStage, ageDays: number | null): BillingUrgency {
  if (ageDays == null) return 'none';
  const sla = stage === 'ready_to_bill' || stage === 'invoiced' ? BILLING_SLA[stage] : null;
  if (!sla) return 'none';
  if (ageDays >= sla.late) return 'late';
  if (ageDays >= sla.watch) return 'watch';
  return 'none';
}

/** Everything the billing views show for one job, from its row and its tally. */
export function billingSummary(
  p: BillableProject,
  tally: InvoiceTally,
  now = Date.now()
): BillingSummary {
  const stage = billingStage(p, tally);
  const ageDays = daysSince(p.completed_at, now);
  return {
    ...tally,
    stage,
    contract: p.value,
    outstanding: tally.billed - tally.paid,
    unbilled: tally.invoiced - tally.billed,
    uninvoiced: p.value - tally.invoiced,
    ageDays,
    urgency: billingUrgency(stage, ageDays),
  };
}

/**
 * Whether a job belongs on the billing desk at all. Work that hasn't been
 * finished and has never been invoiced is the project manager's problem, not
 * the biller's, so it stays off every billing view.
 */
export function onBillingDesk(stage: BillingStage): boolean {
  return stage !== 'not_ready';
}

/**
 * A variance worth saying out loud: the contract value and what's been raised
 * against it don't agree. Only meaningful once something has been invoiced —
 * a job with no invoices is short by its whole value, which is just "unbilled".
 *
 * Rounded to whole dollars so a cent of float drift never reads as a problem.
 */
export function billingVariance(s: BillingSummary): 'short' | 'over' | null {
  if (s.count === 0) return null;
  const diff = Math.round(s.uninvoiced);
  if (diff > 0) return 'short';
  if (diff < 0) return 'over';
  return null;
}
