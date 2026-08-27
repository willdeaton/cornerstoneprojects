'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  getQuoteSyncPair,
  listProjectInvoices,
  applyQuoteSyncFields,
  acknowledgeQuoteSync,
  recordProjectValueChange,
} from '@/lib/data';
import { CONTRACT_LOCK_REASON } from '@/lib/billing';
import {
  buildQuoteSyncState,
  hasQuoteSyncDrift,
  quoteSyncDiff,
  projectFieldsFromQuote,
  quoteRevisionReason,
  type QuoteSyncFieldKey,
  type QuoteSyncState,
} from '@/lib/quote-sync';
import { money } from '@/lib/format';

/*
 * ============================================================================
 *  APPLYING A POST-SALE QUOTE REVISION
 *
 *  Editing a quote that has already been sold is the one case where the quote
 *  and the job it became can disagree, and until now the job simply lost. This
 *  is the path that lets the revision through — deliberately, with a reason,
 *  and never around the guards the billing desk relies on.
 *
 *  Nothing here is a formality. The dialog shows what it knows, but the lock,
 *  the role and the figures are all re-checked HERE against the rows as they
 *  are when Apply is pressed: the dialog's copy of them may be minutes old,
 *  and a quote can be saved from one tab while a job is being invoiced in
 *  another.
 * ============================================================================
 */

async function requireQuoteUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Employees are time-clock-only — the same line the quote actions draw.
  if (user.role === 'employee') throw new Error('Not authorized.');
  return user;
}

/** Admins and managers move money; everyone else can still fix the labels. */
function canChangeValue(role: string): boolean {
  return role === 'admin' || role === 'manager';
}

/** Every view a revision can show up in, whichever half of it moved. */
function revalidateRevision(projectId: number, quoteId: number) {
  revalidatePath('/quotes');
  revalidatePath(`/quotes/${quoteId}/edit`);
  revalidatePath('/projects');
  revalidatePath(`/projects/${projectId}`, 'layout');
  revalidatePath('/billing');
  revalidatePath('/dashboard');
}

/**
 * The revision pending on one sold quote, or `null` when there is nothing to
 * answer for — the quote was never sold, its job is gone, or the two already
 * agree.
 *
 * Shared by the builder's save path and the job's out-of-sync banner so both
 * are describing the same thing, and re-read after a refusal so the dialog can
 * show what is true now rather than what it was refused against.
 */
export async function quoteSyncStateAction(quoteId: number): Promise<QuoteSyncState | null> {
  const user = await requireQuoteUser();
  const pair = await getQuoteSyncPair(quoteId);
  if (!pair) return null;
  // Drift is decided in memory, before the invoice rows are paid for: the
  // overwhelmingly common answer is "nothing changed", and every quote save
  // and every job page load asks this question.
  if (!hasQuoteSyncDrift(quoteSyncDiff(pair.quote, pair.project))) return null;
  const invoices = await listProjectInvoices(pair.project.id);
  return buildQuoteSyncState(pair.quote, pair.project, invoices, user.role);
}

export interface ApplyQuoteRevisionInput {
  /** Detail fields to copy across. Anything not listed is left alone. */
  fields: QuoteSyncFieldKey[];
  /** Whether to move the contract value by the revision's delta. */
  applyValue: boolean;
  /** The customer-facing change order this answers to, when there is one. */
  co_number: string;
  /** Required whenever the value moves. Free text, stored on the history row. */
  reason: string;
}

/**
 * Push a revised sold quote through to its job.
 *
 * The two halves are applied independently and in that order, because they
 * fail independently: the labels are safe on any job at any stage, while the
 * contract value can be refused for a settled billing or a role that isn't
 * allowed to move it. A refusal on the value must not cost the user the
 * address correction that went with it — so the fields land, and the value's
 * refusal comes back as an error against a job that is otherwise up to date.
 *
 * The baseline only moves when the value does. A revision whose money was
 * refused is still pending, and the banner keeps saying so until somebody
 * either applies it or dismisses it deliberately.
 */
export async function applyQuoteRevisionAction(
  quoteId: number,
  input: ApplyQuoteRevisionInput
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireQuoteUser();
  const pair = await getQuoteSyncPair(quoteId);
  if (!pair) return { ok: false, error: 'That quote is no longer a sold job.' };
  const { quote, project } = pair;
  const diff = quoteSyncDiff(quote, project);

  // Only fields this revision actually changed, so a stale dialog can't write
  // back a value the quote no longer carries.
  const drifted = new Set(diff.fields.map((f) => f.key));
  const wanted = projectFieldsFromQuote(quote);
  const fields = Object.fromEntries(
    input.fields.filter((k) => drifted.has(k)).map((k) => [k, wanted[k]])
  );
  await applyQuoteSyncFields(project.id, fields);

  if (!input.applyValue || !diff.value) {
    if (Object.keys(fields).length === 0) {
      return { ok: false, error: 'Nothing was selected to update.' };
    }
    revalidateRevision(project.id, quote.id);
    return { ok: true };
  }

  if (!canChangeValue(user.role)) {
    revalidateRevision(project.id, quote.id);
    return {
      ok: false,
      error:
        "The job's details were updated, but only an admin or manager can move a contract value. Ask one to apply the price.",
    };
  }

  const reason = input.reason.trim();
  if (!reason) {
    revalidateRevision(project.id, quote.id);
    return { ok: false, error: 'Say what changed on the quote.' };
  }

  const res = await recordProjectValueChange({
    project_id: project.id,
    new_value: diff.value.proposed,
    co_number: input.co_number.trim() || null,
    reason: quoteRevisionReason(quote.quote_number, reason),
    changed_by: user.id,
    source: 'quote',
    // Reconciled to the quote as it is now, in the same transaction as the
    // value it justifies.
    sync_quote_value: diff.value.quoteValue,
  });

  revalidateRevision(project.id, quote.id);
  if (res.status === 'missing') return { ok: false, error: 'That job no longer exists.' };
  if (res.status === 'locked') {
    return { ok: false, error: CONTRACT_LOCK_REASON[res.stage] };
  }
  if (res.status === 'noop') {
    // The job is already worth what the revision would make it — somebody got
    // there first with a change order. Reconcile the baseline so the same
    // revision stops being offered, and say so rather than reporting failure.
    await acknowledgeQuoteSync(project.id, diff.value.quoteValue);
    revalidateRevision(project.id, quote.id);
    return { ok: true };
  }
  return { ok: true };
}

/**
 * Clear a pending revision without taking its money — "seen it, not taking
 * it".
 *
 * For a price corrected on the quote that was never a change to the work, or a
 * revision the biller means to answer with a change order of their own. The
 * job is reconciled with the quote as of now; what the job is worth, and the
 * history of how it got there, are untouched.
 */
export async function dismissQuoteRevisionAction(
  quoteId: number
): Promise<{ ok: boolean; error?: string; note?: string }> {
  await requireQuoteUser();
  const pair = await getQuoteSyncPair(quoteId);
  if (!pair) return { ok: false, error: 'That quote is no longer a sold job.' };
  const { quote, project } = pair;
  await acknowledgeQuoteSync(project.id, quote.bid_value);
  revalidateRevision(project.id, quote.id);
  return {
    ok: true,
    note: `${project.name} left at ${money(project.value, { cents: true })}.`,
  };
}
