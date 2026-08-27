/*
 * ============================================================================
 *  POST-SALE QUOTE REVISIONS
 *
 *  Selling a quote copies its figures onto a project (see
 *  `convertQuoteToProject`) and the two have always gone their separate ways
 *  from there. Edit a sold quote — extra scope, a corrected price, a renamed
 *  building — and the quote moved while the job, the billing variance and the
 *  dashboard carried on quoting the old number.
 *
 *  This module is the diff between the two: what a sold quote now says versus
 *  what its job was last reconciled against. It is pure — no React, no
 *  database — so the save path, the confirm dialog and the out-of-sync banner
 *  all reason about drift the same way instead of each deciding for itself.
 *
 *  Two rules do most of the work here:
 *
 *  1. Drift is measured against `projects.quote_synced_value`, never against
 *     `projects.value`. A change order is *entitled* to move a job away from
 *     its quote; measuring against the live contract value would flag every
 *     job that has ever had one.
 *
 *  2. A revision applies as a DELTA, not an overwrite. A job sold at $50,000
 *     and raised to $55,000 by a change order, whose quote is then revised
 *     from $50,000 to $52,000, is worth $57,000 — the $2,000 of new scope on
 *     top of the $5,000 already agreed. Overwriting with the quote's own
 *     figure would silently erase the change order, which is the one thing
 *     the contract-value history exists to prevent.
 * ============================================================================
 */

import {
  billingStage,
  contractLocked,
  tallyInvoices,
  CONTRACT_LOCK_REASON,
  type BillingStage,
} from './billing';
import type { Project, ProjectInvoice, Quote } from './types';

/** Money compared and carried as whole cents, so a float never decides this. */
function cents(n: number): number {
  return Math.round(n * 100);
}

/** Blank and absent are the same thing for a text field on either side. */
function text(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

/** The project detail fields a quote is the source of. */
export type QuoteSyncFieldKey =
  | 'name'
  | 'customer'
  | 'category'
  | 'quote_number'
  | 'site_address';

export interface QuoteSyncFieldDiff {
  key: QuoteSyncFieldKey;
  /** How the field is named on the job, for the dialog and the banner. */
  label: string;
  from: string | null;
  to: string | null;
}

export interface QuoteSyncValueDiff {
  /** The quote's bid value when the job was last reconciled with it. */
  syncedAt: number;
  /** The quote's bid value now. */
  quoteValue: number;
  /** What the revision is worth: `quoteValue - syncedAt`. */
  delta: number;
  /** The job's contract value now — change orders and all. */
  current: number;
  /** `current + delta`, floored at zero. What applying would make it. */
  proposed: number;
}

export interface QuoteSyncDiff {
  /** Null when the quote's value hasn't moved since the last reconciliation. */
  value: QuoteSyncValueDiff | null;
  /** Only the detail fields that actually differ. */
  fields: QuoteSyncFieldDiff[];
}

/**
 * What a project takes from its quote at conversion, in one place so the diff
 * and the write can never disagree about it. Mirrors `convertQuoteToProject`:
 * the job's name falls back to the customer, and the address it drives to is
 * the job's own if the quote named one, otherwise the customer's.
 */
export function projectFieldsFromQuote(quote: Quote): Record<QuoteSyncFieldKey, string | null> {
  return {
    name: text(quote.project_name) ?? quote.customer.trim(),
    customer: quote.customer.trim(),
    category: text(quote.category),
    quote_number: text(quote.quote_number),
    site_address: text(quote.project_location) ?? text(quote.customer_address),
  };
}

const FIELD_LABELS: Record<QuoteSyncFieldKey, string> = {
  name: 'Job name',
  customer: 'Customer',
  category: 'Category',
  quote_number: 'Quote #',
  site_address: 'Site address',
};

/**
 * Only a quote that has actually been sold and became a job can drift. An open
 * or lost quote has nothing downstream to push to, and a sold quote whose
 * project was deleted has nothing left to push to either.
 */
export function quoteCanSync(
  quote: Pick<Quote, 'status'>,
  project: Pick<Project, 'id'> | null | undefined
): boolean {
  return quote.status === 'sold' && !!project;
}

/**
 * The full drift between a sold quote and its job.
 *
 * `quote_synced_value` going NULL is treated as "reconciled at today's figure":
 * a job that predates this feature, or one whose link was repaired by hand, has
 * no baseline to measure a delta from, and inventing one out of `value` would
 * read every change order ever recorded as unapplied quote scope.
 */
export function quoteSyncDiff(quote: Quote, project: Project): QuoteSyncDiff {
  const syncedAt = project.quote_synced_value ?? quote.bid_value;
  const delta = (cents(quote.bid_value) - cents(syncedAt)) / 100;
  const value: QuoteSyncValueDiff | null =
    cents(delta) === 0
      ? null
      : {
          syncedAt,
          quoteValue: quote.bid_value,
          delta,
          current: project.value,
          // A revision that would take a job below zero is clamped rather than
          // refused: nothing is billable below nothing, and the reason on the
          // history row is where the oddity gets explained.
          proposed: Math.max(0, Math.round((project.value + delta) * 100) / 100),
        };

  const wanted = projectFieldsFromQuote(quote);
  const have: Record<QuoteSyncFieldKey, string | null> = {
    name: text(project.name),
    customer: text(project.customer),
    category: text(project.category),
    quote_number: text(project.quote_number),
    site_address: text(project.site_address),
  };
  const fields = (Object.keys(FIELD_LABELS) as QuoteSyncFieldKey[])
    .filter((key) => wanted[key] !== have[key])
    // A quote that has had a field cleared doesn't get to blank the job's copy:
    // an address typed on the job is worth more than one deleted off the quote.
    .filter((key) => wanted[key] !== null)
    .map((key) => ({ key, label: FIELD_LABELS[key], from: have[key], to: wanted[key] }));

  return { value, fields };
}

/** Whether there is anything at all to push. */
export function hasQuoteSyncDrift(diff: QuoteSyncDiff): boolean {
  return diff.value !== null || diff.fields.length > 0;
}

/**
 * The reason written onto the history row when a revision is applied. The user
 * types their own — this is the prefix that makes the row self-describing, so
 * the entry reads as a quote revision at a glance and still carries the "why"
 * somebody gave for it.
 */
export function quoteRevisionReason(quoteNumber: string | null, reason: string): string {
  const q = text(quoteNumber);
  const why = reason.trim();
  return q ? `Quote ${q} revised — ${why}` : `Quote revised — ${why}`;
}

/**
 * Everything the confirm dialog and the out-of-sync banner need about one
 * revision, in the shape both are handed it.
 *
 * `stage` and `canChangeValue` are carried rather than re-derived on the
 * client because neither is knowable there — and neither is trusted from
 * there either: `applyQuoteRevisionAction` re-checks the lock and the role
 * against the rows as they are when Apply is pressed.
 */
export interface QuoteSyncState {
  quoteId: number;
  quoteNumber: string | null;
  projectId: number;
  projectName: string;
  diff: QuoteSyncDiff;
  /** Where the job's billing stands — what decides whether the value can move. */
  stage: BillingStage;
  /** Settled billing: the contract value can't move until it's reopened. */
  locked: boolean;
  /** The way back in, when locked. */
  lockReason: string | null;
  /** Admins and managers only, the same line the billing desk draws. */
  canChangeValue: boolean;
}

/**
 * Assemble one revision into the shape every surface reads it in — or `null`
 * when there is nothing to answer for.
 *
 * Pure, and given the invoice rows rather than fetching them, so the save
 * path's action and the job page's cached loader compose the same function
 * instead of each deciding for itself what counts as drift or what counts as
 * locked. Two descriptions of the same disagreement is exactly how a banner
 * ends up saying something the dialog then contradicts.
 */
export function buildQuoteSyncState(
  quote: Quote,
  project: Project,
  invoices: Pick<ProjectInvoice, 'amount' | 'billed' | 'paid'>[],
  role: string
): QuoteSyncState | null {
  if (!quoteCanSync(quote, project)) return null;
  const diff = quoteSyncDiff(quote, project);
  if (!hasQuoteSyncDrift(diff)) return null;

  const stage = billingStage(project, tallyInvoices(invoices));
  const locked = contractLocked(stage);
  return {
    quoteId: quote.id,
    quoteNumber: quote.quote_number,
    projectId: project.id,
    projectName: project.name,
    diff,
    stage,
    locked,
    lockReason: locked ? CONTRACT_LOCK_REASON[stage] : null,
    // The same line the billing desk draws: money is admins and managers.
    canChangeValue: role === 'admin' || role === 'manager',
  };
}
