import 'server-only';
import { getDb } from './db';
import { sendSoldWorkDigest, sendCompletedJobsDigest } from './email/send';
import { pruneSentDigestEvents } from './email/digest-queue';
import { zonedNow } from './payroll-week';

/*
 * The daily digest job: once a day, late in the working day, send the two
 * end-of-day recaps — the work we sold and the jobs we completed — each as ONE
 * email with a summary and the list behind it. Marking a quote sold or a job
 * complete only queues an event (lib/email/digest-queue.ts); this is what
 * turns the queue into mail.
 *
 * A 5-minute interval checks the clock in the payroll timezone (PAYROLL_TZ,
 * default America/Chicago) and fires from DIGEST_SEND_HOUR (default 17:00)
 * onward, so "today's recap" means today for the office, not UTC.
 *
 * Duplicate-send protection mirrors the weekly approval job: an atomic
 * INSERT ... ON CONFLICT DO NOTHING run-lock in the settings table, keyed by
 * the local date AND the digest kind, so exactly one worker sends each digest
 * each day even across restarts and multiple processes. The claim is released
 * only when the send actually failed — a day with nothing to report is a
 * finished day, not a retry, which is what keeps it to one email a day.
 *
 * This module is loaded lazily from instrumentation.ts, and only in the Node
 * runtime — importing it eagerly would pull `pg` into the Edge bundle.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Local hour (in PAYROLL_TZ) from which the daily digests may fire. */
function sendFromHour(): number {
  const raw = Number(process.env.DIGEST_SEND_HOUR);
  return Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : 17;
}

/** The local calendar date (YYYY-MM-DD) the run-lock is keyed by. */
function localDate(): string {
  const z = zonedNow();
  return `${z.year}-${String(z.month).padStart(2, '0')}-${String(z.day).padStart(2, '0')}`;
}

const DIGESTS = [
  { key: 'sold_work', label: 'sold-work', send: sendSoldWorkDigest },
  { key: 'completed_jobs', label: 'completed-jobs', send: sendCompletedJobsDigest },
] as const;

/** One scheduler tick. Exported for the manual/test path; never throws. */
export async function runDailyDigestTick(): Promise<void> {
  try {
    if (zonedNow().hour < sendFromHour()) return;

    const day = localDate();
    const db = await getDb();

    // Each digest carries its own lock, so one of them failing (or having
    // nothing to report) never holds the other back.
    for (const digest of DIGESTS) {
      const lockKey = `digest_email_sent_${digest.key}_${day}`;
      const claim = await db.query(
        `INSERT INTO settings (key, value) VALUES ($1, now()::text)
         ON CONFLICT (key) DO NOTHING`,
        [lockKey]
      );
      if (claim.rowCount !== 1) continue;

      let result: Awaited<ReturnType<typeof digest.send>> | undefined;
      try {
        result = await digest.send();
      } finally {
        // Only a real failure retries. 'skipped' means the day's digest is
        // settled — nothing queued, nobody subscribed, or email unconfigured —
        // and re-running it would mail the same list again.
        if (!result || result.status === 'error') {
          await db.query('DELETE FROM settings WHERE key = $1', [lockKey]).catch(() => {});
        }
      }
      if (result.status === 'skipped' && result.jobs === 0) {
        // Quiet day: don't log a line per tick's worth of nothing.
        continue;
      }
      console.log(
        `[digest-emails] ${digest.label} digest for ${day}: ${result.status}` +
          ` (${result.jobs} job(s) to ${result.count}/${result.attempted} recipient(s)` +
          `${result.reason ? `; ${result.reason}` : ''})`
      );
    }

    // Housekeeping: drop reported queue rows and the stale daily locks behind
    // them, so neither table grows without bound.
    await pruneSentDigestEvents();
    await db.query(
      `DELETE FROM settings
        WHERE key LIKE 'digest_email_sent_%' AND updated_at < now() - interval '60 days'`
    );
  } catch (err) {
    // Never crash the server over the scheduler.
    console.error('[digest-emails] scheduler tick failed:', err);
  }
}

/** Start the 5-minute check. Safe to call once per server process. */
export function startDailyDigestScheduler(): void {
  const timer = setInterval(() => {
    void runDailyDigestTick();
  }, CHECK_INTERVAL_MS);
  // Don't let the interval keep the process alive on shutdown.
  timer.unref?.();
}
