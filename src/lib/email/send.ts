import 'server-only';
import { getDb } from '../db';
import type { Project } from '../types';
import { sendEmail, hasApiKey } from './transport';
import {
  getEmailSettings,
  newProjectRecipients,
  completionRecipients,
  type Recipient,
} from './settings';
import {
  buildTestEmail,
  buildNewProjectEmail,
  buildJobCompletedEmail,
  buildPasswordResetEmail,
  buildWelcomeEmail,
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

/* --------------------------------------------------- Event-driven: welcome */

/**
 * EVENT-DRIVEN, best-effort. Called inline after an admin creates a new user —
 * sends the new user a welcome email with a sign-in link. Never throws: the
 * account creation must complete regardless of email outcome.
 */
export async function sendWelcomeEmail(
  toEmail: string,
  firstName: string,
  loginEmail: string,
  loginUrl: string
): Promise<SendResult> {
  try {
    const loaded = await loadConfigOrReason();
    if (!loaded.ok) {
      console.warn(`[email] welcome not sent: ${loaded.reason}`);
      return { status: 'error', count: 0, attempted: 1, reason: loaded.reason };
    }
    const { subject, html } = buildWelcomeEmail(firstName, loginEmail, loginUrl);
    await sendEmail(loaded.cfg, toEmail, subject, html);
    return { status: 'sent', count: 1, attempted: 1 };
  } catch (err) {
    console.error('[email] welcome failed:', err);
    return { status: 'error', count: 0, attempted: 1, reason: (err as Error).message };
  }
}

/* --------------------------------------------- Event-driven subscription emails */

async function loadProject(projectId: number): Promise<Project | undefined> {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  return rows[0] as Project | undefined;
}

/**
 * EVENT-DRIVEN, best-effort. Called inline after a quote is sold and converted
 * into a project — emails everyone subscribed to new-project notifications a
 * short status report on the new job. Never throws: the conversion must
 * complete regardless of email outcome.
 */
export async function sendNewProjectEmail(projectId: number): Promise<SendResult> {
  return sendProjectEvent(projectId, newProjectRecipients, buildNewProjectEmail, 'new-project');
}

/**
 * EVENT-DRIVEN, best-effort. Called inline when a project is marked complete —
 * emails everyone subscribed to completion notifications. Never throws.
 */
export async function sendJobCompletedEmail(projectId: number): Promise<SendResult> {
  return sendProjectEvent(projectId, completionRecipients, buildJobCompletedEmail, 'job-completed');
}

/** Shared body for the two event-driven, per-project subscription emails. */
async function sendProjectEvent(
  projectId: number,
  resolveRecipients: () => Promise<Recipient[]>,
  render: (r: Recipient, p: Project) => { subject: string; html: string },
  label: string
): Promise<SendResult> {
  try {
    const loaded = await loadConfigOrReason();
    if (!loaded.ok) {
      console.warn(`[email] ${label} not sent: ${loaded.reason}`);
      return { status: 'error', count: 0, attempted: 0, reason: loaded.reason };
    }
    const project = await loadProject(projectId);
    if (!project) return { status: 'error', count: 0, attempted: 0, reason: 'project not found' };

    const recipients = await resolveRecipients();
    if (recipients.length === 0) {
      console.warn(`[email] ${label}: no subscribed recipients (no-op).`);
      return { status: 'sent', count: 0, attempted: 0 };
    }
    const sent = await deliverEach(recipients, (r) => render(r, project), loaded.cfg);
    return { status: 'sent', count: sent, attempted: recipients.length };
  } catch (err) {
    // Best-effort: never let an email failure bubble into the business action.
    console.error(`[email] ${label} failed:`, err);
    return { status: 'error', count: 0, attempted: 0, reason: (err as Error).message };
  }
}

/* --------------------------------------------------------------- shared loop */

/** Loop recipients, catching per-recipient so one bad address can't abort. */
async function deliverEach(
  recipients: Recipient[],
  render: (r: Recipient) => { subject: string; html: string },
  cfg: { from_name: string; from_email: string }
): Promise<number> {
  let sent = 0;
  for (const r of recipients) {
    try {
      const { subject, html } = render(r);
      await sendEmail(cfg, r.email, subject, html);
      sent++;
    } catch (err) {
      console.error(`[email] send to ${r.email} failed:`, err);
    }
  }
  return sent;
}
