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
  buildScheduleEmail,
  renderWeeklyApprovalEmail,
  type ScheduleLine,
} from './templates';
import { listManagersWithReports, managerWeekSummary } from '../data';
import { listScheduleTasks, listAssigneeContacts, loadWorkCalendar } from '../schedule-data';
import { assigneeWindows, computeSchedule, rangesOverlap } from '../schedule-math';
import { issueApprovalToken } from '../time-approval-tokens';
import { appOrigin } from '../app-origin';

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

/* ------------------------------------------------- On demand: schedule send */

export interface SendScheduleResult extends SendResult {
  /** Assignees with work in the range who couldn't be emailed, and why. */
  skipped: { name: string; reason: string }[];
}

/** "Mon, Mar 3" — compact enough for a table cell, unambiguous about the day. */
function scheduleDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** One day, or a span — a single-day phase shouldn't read "Mar 3 – Mar 3". */
function scheduleSpan(start: string, end: string): string {
  return start === end ? scheduleDay(start) : `${scheduleDay(start)} – ${scheduleDay(end)}`;
}

/**
 * ON DEMAND: a manager sends out the schedule for a date range. Each assignee
 * gets one email covering only their own work, so recipients come from the
 * assignments themselves rather than the flag-based subscription lists (the
 * same way the password-reset and welcome sends address a known person).
 *
 * Best-effort per recipient, like every other send here: one unreachable
 * address never aborts the batch. Assignees with no address on file are
 * returned in `skipped` rather than silently dropped.
 */
export async function sendScheduleEmails(
  from: string,
  to: string,
  includeSubs: boolean
): Promise<SendScheduleResult> {
  const skipped: { name: string; reason: string }[] = [];
  try {
    const loaded = await loadConfigOrReason();
    if (!loaded.ok) {
      return { status: 'error', count: 0, attempted: 0, reason: loaded.reason, skipped };
    }

    const [tasks, calendar, contacts] = await Promise.all([
      listScheduleTasks(),
      loadWorkCalendar(),
      listAssigneeContacts(),
    ]);
    const { windows } = computeSchedule(tasks, calendar);
    const booked = assigneeWindows(tasks, windows).filter(
      (w) => rangesOverlap(w.start, w.end, from, to) && (includeSubs || w.key.startsWith('user:'))
    );

    // Group each assignee's work, earliest first, and hang on to the job
    // context the email body needs.
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const perAssignee = new Map<string, { name: string; lines: ScheduleLine[] }>();
    for (const w of [...booked].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))) {
      const task = taskById.get(w.taskId);
      const entry = perAssignee.get(w.key) ?? { name: w.name, lines: [] };
      entry.lines.push({
        dates: scheduleSpan(w.start, w.end),
        project: w.projectName,
        phase: w.taskName,
        location: task?.location ?? null,
        notes: task?.notes ?? null,
      });
      perAssignee.set(w.key, entry);
    }

    if (perAssignee.size === 0) {
      return { status: 'sent', count: 0, attempted: 0, reason: 'No one is scheduled in that range.', skipped };
    }

    const byKey = new Map(contacts.map((c) => [c.key, c]));
    const range = { from: scheduleDay(from), to: scheduleDay(to) };
    let sent = 0;
    let attempted = 0;

    for (const [key, entry] of perAssignee) {
      const contact = byKey.get(key);
      if (!contact?.email) {
        skipped.push({ name: entry.name, reason: 'No email address on file' });
        continue;
      }
      attempted++;
      try {
        const firstName = entry.name.trim().split(/\s+/)[0] ?? '';
        const { subject, html } = buildScheduleEmail(firstName, range, entry.lines);
        await sendEmail(loaded.cfg, contact.email, subject, html);
        sent++;
      } catch (err) {
        console.error(`[email] schedule send to ${contact.email} failed:`, err);
        skipped.push({ name: entry.name, reason: 'Send failed' });
      }
    }

    return { status: 'sent', count: sent, attempted, skipped };
  } catch (err) {
    console.error('[email] schedule send failed:', err);
    return { status: 'error', count: 0, attempted: 0, reason: (err as Error).message, skipped };
  }
}

/* ----------------------------------------- Scheduled: weekly time approval */

/** "Feb 9 – Feb 15, 2026" for a Monday-start week. */
function approvalWeekLabel(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start.getTime() + 6 * 864e5);
  const fmt = (d: Date, year: boolean) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(year ? { year: 'numeric' } : {}),
    });
  return `${fmt(start, false)} – ${fmt(end, true)}`;
}

/**
 * The app's public origin, safe to call outside a request (the scheduler has
 * no request headers to fall back on — configure APP_URL for correct links).
 */
async function originForLinks(): Promise<string> {
  try {
    // appOrigin() prefers APP_URL / NEXT_PUBLIC_APP_URL and only falls back to
    // request headers, which the scheduler doesn't have — hence the catch.
    return await appOrigin();
  } catch {
    return 'http://localhost:3000';
  }
}

/**
 * SCHEDULED (Monday morning), best-effort. For every active manager with
 * active direct reports: build the prior week's summary, mint an approval
 * token, and email the day-by-day breakdown with an approve link. One email
 * per manager; a failure for one manager never aborts the rest. Never throws.
 *
 * Returns 'skipped' (not 'error') when email simply isn't configured, so the
 * scheduler stays quiet on installs without SendGrid.
 */
export async function sendWeeklyApprovalEmails(weekStart: string): Promise<SendResult> {
  try {
    const loaded = await loadConfigOrReason();
    if (!loaded.ok) {
      console.warn(`[email] weekly-approval not sent: ${loaded.reason}`);
      return { status: 'skipped', count: 0, attempted: 0, reason: loaded.reason };
    }

    const managers = await listManagersWithReports();
    if (managers.length === 0) {
      return {
        status: 'skipped',
        count: 0,
        attempted: 0,
        reason: 'No managers with direct reports.',
      };
    }

    const origin = await originForLinks();
    const weekLabel = approvalWeekLabel(weekStart);

    let sent = 0;
    let attempted = 0;    for (const m of managers) {
      try {
        const toEmail = m.personal_email || m.work_email || m.email;
        if (!toEmail) {
          console.warn(`[email] weekly-approval: no address for manager ${m.name} (skipped).`);
          continue;
        }
        attempted++;
        const summary = await managerWeekSummary(m.id, weekStart);
        const token = await issueApprovalToken(m.id, summary.week_start);
        const approveUrl = `${origin}/approve-time?token=${token}`;
        const { subject, html } = renderWeeklyApprovalEmail(
          m.name,
          weekLabel,
          summary.reports,
          approveUrl
        );
        await sendEmail(loaded.cfg, toEmail, subject, html);
        sent++;
      } catch (err) {
        console.error(`[email] weekly-approval to ${m.name} failed:`, err);
      }
    }
    // Every single send failing is an error, not a success with count 0 — the
    // caller (and the scheduler's run-lock) must be able to tell them apart.
    if (attempted > 0 && sent === 0) {
      return {
        status: 'error',
        count: 0,
        attempted,
        reason: 'Every approval email failed to send; see server logs.',
      };
    }
    return { status: 'sent', count: sent, attempted };
  } catch (err) {
    // Best-effort: the scheduler must never crash over an email problem.
    console.error('[email] weekly-approval failed:', err);
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
