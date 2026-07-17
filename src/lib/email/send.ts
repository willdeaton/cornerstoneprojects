import 'server-only';
import { createHash } from 'node:crypto';
import { getDb } from '../db';
import type { Project } from '../types';
import { sendEmail, hasApiKey, type EmailAttachment } from './transport';
import {
  getEmailSettings,
  projectReminderRecipients,
  completionReportRecipients,
  scheduleChangeRecipients,
  tryAcquireProjectReminderLock,
  markProjectReminderRun,
  tryAcquireCompletionReportLock,
  markCompletionReportRun,
  type Recipient,
} from './settings';
import {
  buildTestEmail,
  buildProjectReminderEmail,
  buildCompletionReportEmail,
  buildScheduleChangeEmail,
  buildPasswordResetEmail,
} from './templates';

/*
 * Every send path follows the same shape (section 5 of the design):
 *   resolve recipients from flag -> load cfg -> verify API key + from_email
 *   -> loop recipients calling sendEmail, catching Exception PER recipient so
 *   one bad address never aborts the batch.
 * If no user carries the flag, the send is a no-op (count 0).
 */

export interface SendResult {
  status: 'sent' | 'skipped' | 'error';
  count: number;
  attempted: number;
  reason?: string;
}

/** Config is usable only if the API key env var and from_email are both set. */
async function loadConfigOrReason(): Promise<
  | { ok: true; cfg: { from_name: string; from_email: string } }
  | { ok: false; reason: string }
> {
  if (!hasApiKey()) return { ok: false, reason: 'API key env var is not set.' };
  const s = await getEmailSettings();
  if (!s.from_email) return { ok: false, reason: 'from_email is not configured.' };
  return { ok: true, cfg: { from_name: s.from_name, from_email: s.from_email } };
}

/* ------------------------------------------------------------ Test email */

/** Send a one-off test message to the configured from_email address. */
export async function sendTestEmail(): Promise<SendResult> {
  const loaded = await loadConfigOrReason();
  if (!loaded.ok) return { status: 'error', count: 0, attempted: 0, reason: loaded.reason };
  const { subject, html } = buildTestEmail();
  await sendEmail(loaded.cfg, loaded.cfg.from_email, subject, html);
  return { status: 'sent', count: 1, attempted: 1 };
}

/* ---------------------------------------- Event-driven: password reset */

/**
 * Send a single password-reset link to one address. Unlike the subscription
 * emails, the recipient is explicit (the account owner), so this bypasses the
 * flag-based recipient resolver but still funnels through the same transport.
 */
export async function sendPasswordResetEmail(
  toEmail: string,
  firstName: string,
  resetUrl: string
): Promise<SendResult> {
  const loaded = await loadConfigOrReason();
  if (!loaded.ok) return { status: 'error', count: 0, attempted: 1, reason: loaded.reason };
  const { subject, html } = buildPasswordResetEmail(firstName, resetUrl);
  await sendEmail(loaded.cfg, toEmail, subject, html);
  return { status: 'sent', count: 1, attempted: 1 };
}

/* --------------------------------------------- Scheduled: project reminders */

async function activeProjects(): Promise<Project[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT * FROM projects WHERE status != 'completed' ORDER BY due_date NULLS LAST`
  );
  return rows as Project[];
}

/**
 * SCHEDULED weekly reminder. Acquire the singleton lock (min_gap ~60 for cron,
 * 0 for a manual trigger) BEFORE sending so multiple workers don't double-send.
 */
export async function sendProjectReminders(minGapMinutes = 60): Promise<SendResult> {
  if (!(await tryAcquireProjectReminderLock(minGapMinutes))) {
    return { status: 'skipped', count: 0, attempted: 0, reason: 'debounced by run lock' };
  }
  try {
    const loaded = await loadConfigOrReason();
    if (!loaded.ok) {
      console.warn(`[email] project reminders not sent: ${loaded.reason}`);
      await markProjectReminderRun('error');
      return { status: 'error', count: 0, attempted: 0, reason: loaded.reason };
    }
    const recipients = await projectReminderRecipients();
    if (recipients.length === 0) {
      console.warn('[email] project reminders: no subscribed recipients (no-op).');
      await markProjectReminderRun('sent');
      return { status: 'sent', count: 0, attempted: 0 };
    }
    const projects = await activeProjects();
    const sent = await deliverEach(recipients, (r) => {
      const { subject, html } = buildProjectReminderEmail(r, projects);
      return { subject, html };
    }, loaded.cfg);
    await markProjectReminderRun('sent');
    return { status: 'sent', count: sent, attempted: recipients.length };
  } catch (err) {
    await markProjectReminderRun('error');
    throw err;
  }
}

/* ----------------------------------------- Scheduled: completion report */

/**
 * SCHEDULED periodic status report. Same shape as reminders. Attachments are
 * supported by the transport — pass base64 report files through if needed.
 */
export async function sendCompletionReport(
  minGapMinutes = 60,
  attachments?: EmailAttachment[]
): Promise<SendResult> {
  if (!(await tryAcquireCompletionReportLock(minGapMinutes))) {
    return { status: 'skipped', count: 0, attempted: 0, reason: 'debounced by run lock' };
  }
  try {
    const loaded = await loadConfigOrReason();
    if (!loaded.ok) {
      console.warn(`[email] completion report not sent: ${loaded.reason}`);
      await markCompletionReportRun('error');
      return { status: 'error', count: 0, attempted: 0, reason: loaded.reason };
    }
    const recipients = await completionReportRecipients();
    if (recipients.length === 0) {
      console.warn('[email] completion report: no subscribed recipients (no-op).');
      await markCompletionReportRun('sent');
      return { status: 'sent', count: 0, attempted: 0 };
    }
    const db = await getDb();
    const { rows } = await db.query('SELECT * FROM projects ORDER BY value DESC');
    const projects = rows as Project[];
    const sent = await deliverEach(recipients, (r) => {
      const { subject, html } = buildCompletionReportEmail(r, projects);
      return { subject, html };
    }, loaded.cfg, attachments);
    await markCompletionReportRun('sent');
    return { status: 'sent', count: sent, attempted: recipients.length };
  } catch (err) {
    await markCompletionReportRun('error');
    throw err;
  }
}

/* ------------------------------- Event-driven: schedule change notification */

/** Signature of the schedule-relevant fields; changes only when they change. */
function scheduleSignature(p: Project): string {
  const material = [p.status, p.start_date, p.end_date, p.due_date].join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/**
 * EVENT-DRIVEN, best-effort. Called inline after a project schedule changes.
 * Only emails recipients whose stored per-recipient signature differs from the
 * project's current one, then records a snapshot on success so re-runs don't
 * re-notify unchanged people. Never throws — the triggering business action
 * must complete regardless of email outcome.
 */
export async function notifyScheduleChange(projectId: number): Promise<SendResult> {
  try {
    const loaded = await loadConfigOrReason();
    if (!loaded.ok) {
      console.warn(`[email] schedule-change not sent: ${loaded.reason}`);
      return { status: 'error', count: 0, attempted: 0, reason: loaded.reason };
    }
    const db = await getDb();
    const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    const project = rows[0] as Project | undefined;
    if (!project) return { status: 'error', count: 0, attempted: 0, reason: 'project not found' };

    const recipients = await scheduleChangeRecipients();
    if (recipients.length === 0) {
      console.warn('[email] schedule-change: no subscribed recipients (no-op).');
      return { status: 'sent', count: 0, attempted: 0 };
    }

    const signature = scheduleSignature(project);

    // Which recipients have already been notified of THIS signature?
    const { rows: seenRows } = await db.query(
      'SELECT recipient_email FROM schedule_change_notifications WHERE project_id = $1 AND signature = $2',
      [projectId, signature]
    );
    const alreadyNotified = new Set(
      (seenRows as { recipient_email: string }[]).map((r) => r.recipient_email)
    );

    const changed = recipients.filter((r) => !alreadyNotified.has(r.email));
    if (changed.length === 0) return { status: 'sent', count: 0, attempted: 0 };

    let sent = 0;
    for (const r of changed) {
      try {
        const { subject, html } = buildScheduleChangeEmail(r, project);
        await sendEmail(loaded.cfg, r.email, subject, html);
        // Record the per-recipient snapshot only on a successful send.
        await db.query(
          `INSERT INTO schedule_change_notifications (project_id, recipient_email, signature, notified_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (project_id, recipient_email)
           DO UPDATE SET signature = excluded.signature, notified_at = now()`,
          [projectId, r.email, signature]
        );
        sent++;
      } catch (err) {
        console.error(`[email] schedule-change to ${r.email} failed:`, err);
      }
    }
    return { status: 'sent', count: sent, attempted: changed.length };
  } catch (err) {
    // Best-effort: never let email failure bubble into the business action.
    console.error('[email] notifyScheduleChange failed:', err);
    return { status: 'error', count: 0, attempted: 0, reason: (err as Error).message };
  }
}

/* --------------------------------------------------------------- shared loop */

/** Loop recipients, catching per-recipient so one bad address can't abort. */
async function deliverEach(
  recipients: Recipient[],
  render: (r: Recipient) => { subject: string; html: string },
  cfg: { from_name: string; from_email: string },
  attachments?: EmailAttachment[]
): Promise<number> {
  let sent = 0;
  for (const r of recipients) {
    try {
      const { subject, html } = render(r);
      await sendEmail(cfg, r.email, subject, html, attachments);
      sent++;
    } catch (err) {
      console.error(`[email] send to ${r.email} failed:`, err);
    }
  }
  return sent;
}
