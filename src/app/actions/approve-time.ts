'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth';
import { approveWeek, managerWeekSummary } from '@/lib/data';
import { validateApprovalToken } from '@/lib/time-approval-tokens';
import { sendWeeklyApprovalEmails, type SendResult } from '@/lib/email/send';
import { priorWeekStart } from '@/lib/payroll-week';

/*
 * Approve-from-email actions. The PUBLIC /approve-time page posts here with
 * the RAW token in a hidden field — the token IS the credential (no session),
 * so every action re-validates it and only ever writes approvals for the
 * token's manager's own active direct reports, for the token's week.
 */

/*
 * Both form actions return void (plain <form action> posts from a server
 * component): on an invalid/expired token they simply no-op, and the page —
 * which re-validates the token on every render — shows the friendly error.
 */

/** Approve one direct report's week from the emailed link. */
export async function approveFromEmailAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const userId = Number(formData.get('user_id'));
  const t = await validateApprovalToken(token);
  if (!t || !Number.isInteger(userId)) return;

  // The token only authorizes the manager's own active direct reports.
  const summary = await managerWeekSummary(t.managerId, t.weekStart);
  if (!summary.reports.some((r) => r.user_id === userId)) return;

  await approveWeek(userId, t.weekStart, t.managerId, 'email');
  revalidatePath('/approve-time');
  revalidatePath('/timesheets');
}

/** Approve every not-yet-approved direct report's week from the emailed link. */
export async function approveAllFromEmailAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const t = await validateApprovalToken(token);
  if (!t) return;

  const summary = await managerWeekSummary(t.managerId, t.weekStart);
  for (const r of summary.reports) {
    if (!r.approved) await approveWeek(r.user_id, t.weekStart, t.managerId, 'email');
  }
  revalidatePath('/approve-time');
  revalidatePath('/timesheets');
}

/*
 * Manual trigger from Settings -> Email: send the Monday approval emails for
 * the prior payroll week right now. Admin-only; deliberately bypasses the
 * scheduler's once-per-week run-lock so a missed or re-needed send can always
 * be pushed out by hand.
 */
export async function sendApprovalEmailsNowAction(): Promise<
  { ok: boolean; error?: string; result?: SendResult; weekStart?: string }
> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') return { ok: false, error: 'Not authorized.' };

  const weekStart = priorWeekStart();
  const result = await sendWeeklyApprovalEmails(weekStart);
  return {
    ok: result.status !== 'error',
    result,
    weekStart,
    ...(result.status === 'error' ? { error: result.reason } : {}),
  };
}
