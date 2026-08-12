import 'server-only';
import { getDb } from './db';
import { sendWeeklyApprovalEmails } from './email/send';
import { zonedNow, priorWeekStart } from './payroll-week';

/*
 * The one background job in the app: the Monday-morning weekly time-approval
 * email. A 5-minute interval checks the clock in the payroll timezone
 * (PAYROLL_TZ, default America/Chicago) and, on Mondays from 7am onward, sends
 * every manager a summary of their direct reports' prior week with an approve
 * link.
 *
 * Duplicate-send protection is an atomic INSERT ... ON CONFLICT DO NOTHING
 * run-lock in the settings table keyed by the prior week's Monday, so exactly
 * one worker (even across restarts and multiple processes) does the send. The
 * claim is released again when nothing actually went out, so a failed or
 * unconfigured Monday retries instead of silently losing the week.
 *
 * This module is loaded lazily from instrumentation.ts, and only in the Node
 * runtime — importing it eagerly would pull `pg` into the Edge bundle.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Local hour (in PAYROLL_TZ) from which the Monday send may fire. */
const SEND_FROM_HOUR = 7;

/** One scheduler tick. Exported for the manual/test path; never throws. */
export async function runApprovalEmailTick(): Promise<void> {
  try {
    const now = zonedNow();
    if (now.weekday !== 'Mon' || now.hour < SEND_FROM_HOUR) return;

    const weekStart = priorWeekStart();
    const lockKey = `approval_email_sent_${weekStart}`;

    const db = await getDb();
    const claim = await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, now()::text)
       ON CONFLICT (key) DO NOTHING`,
      [lockKey]
    );
    if (claim.rowCount !== 1) return;

    let result: Awaited<ReturnType<typeof sendWeeklyApprovalEmails>> | undefined;
    try {
      result = await sendWeeklyApprovalEmails(weekStart);
    } finally {
      // Nothing went out (email unconfigured, no managers, or every send
      // failed) — release the claim so a later tick can try again.
      if (!result || result.count === 0) {
        await db.query('DELETE FROM settings WHERE key = $1', [lockKey]).catch(() => {});
      }
    }
    console.log(
      `[approval-emails] weekly send for ${weekStart}: ${result.status}` +
        ` (${result.count}/${result.attempted} sent${result.reason ? `; ${result.reason}` : ''})`
    );
  } catch (err) {
    // Never crash the server over the scheduler.
    console.error('[approval-emails] scheduler tick failed:', err);
  }
}

/** Start the 5-minute check. Safe to call once per server process. */
export function startApprovalEmailScheduler(): void {
  const timer = setInterval(() => {
    void runApprovalEmailTick();
  }, CHECK_INTERVAL_MS);
  // Don't let the interval keep the process alive on shutdown.
  timer.unref?.();
}
