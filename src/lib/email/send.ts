import 'server-only';
import { sendEmail, hasApiKey } from './transport';
import {
  getEmailSettings,
  newProjectRecipients,
  completionRecipients,
  type Recipient,
} from './settings';
import {
  buildTestEmail,
  buildSoldWorkDigestEmail,
  buildCompletedJobsDigestEmail,
  buildPasswordResetEmail,
  buildWelcomeEmail,
  buildScheduleEmail,
  renderWeeklyApprovalEmail,
  type DigestJobLine,
  type RenderedEmail,
  type ScheduleLine,
} from './templates';
import {
  pendingDigestEvents,
  markDigestEventsSent,
  type DigestEvent,
  type DigestKind,
} from './digest-queue';
import { listManagersWithReports, managerWeekSummary } from '../data';
import {
  listScheduleTasks,
  listAssigneeContacts,
  listCrewNotesForProjects,
  loadWorkCalendar,
} from '../schedule-data';
import {
  assigneeBookings,
  computeSchedule,
  rangesOverlap,
  shiftLabel,
  today as todayISO,
} from '../schedule-math';
import { issueApprovalToken } from '../time-approval-tokens';
import { payrollTimeZone } from '../payroll-week';
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

/* ------------------------------------------- Scheduled: the two daily digests */

/**
 * Selling a quote and completing a job are the two moments the office wants to
 * hear about, but hearing about each one the second it happens buried everyone
 * on a busy afternoon. Both are now QUEUED (see digest-queue.ts) and reported
 * once a day, one email per kind: a summary line plus the list of what was
 * sold / what was finished.
 */

export interface SendDigestResult extends SendResult {
  /** Jobs the email listed — 0 means there was nothing to report. */
  jobs: number;
}

/**
 * "Tue, Aug 26". Rendered in the payroll timezone, the same clock the digest
 * scheduler fires on, so the date in the subject is the crews' date rather
 * than the server's.
 */
function digestDay(when: Date): string {
  return when.toLocaleDateString('en-US', {
    timeZone: payrollTimeZone(),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function digestLine(e: DigestEvent): DigestJobLine {
  return {
    day: digestDay(new Date(e.created_at)),
    project: e.name,
    customer: e.customer,
    value: e.value,
    quoteNumber: e.quote_number,
    category: e.category,
  };
}

/**
 * SCHEDULED (once a day), best-effort. Drains one digest queue and sends the
 * day's summary to everyone carrying the matching subscription flag.
 *
 * Events are stamped sent only when at least one email actually went out, so a
 * misconfigured or unreachable send day rolls into the next digest instead of
 * silently swallowing the news. Returns 'skipped' (not 'error') when email
 * isn't configured, and when there was simply nothing to report.
 */
async function sendDigest(
  kind: DigestKind,
  resolveRecipients: () => Promise<Recipient[]>,
  render: (r: Recipient, dayLabel: string, lines: DigestJobLine[]) => RenderedEmail,
  keep: (e: DigestEvent) => boolean,
  label: string
): Promise<SendDigestResult> {
  try {
    const events = await pendingDigestEvents(kind);
    if (events.length === 0) {
      return { status: 'skipped', count: 0, attempted: 0, jobs: 0, reason: 'Nothing to report.' };
    }

    // Events that no longer describe the job (a completed job reopened before
    // the digest ran) are dropped, not reported — but they're still stamped, so
    // completing that job again queues a fresh event for a later digest.
    const stale = events.filter((e) => !keep(e));
    const lines = events.filter(keep);
    if (lines.length === 0) {
      await markDigestEventsSent(stale.map((e) => e.id));
      return {
        status: 'skipped',
        count: 0,
        attempted: 0,
        jobs: 0,
        reason: 'Nothing left to report once reopened jobs were dropped.',
      };
    }

    const loaded = await loadConfigOrReason();
    if (!loaded.ok) {
      console.warn(`[email] ${label} digest not sent: ${loaded.reason}`);
      return { status: 'skipped', count: 0, attempted: 0, jobs: 0, reason: loaded.reason };
    }

    const recipients = await resolveRecipients();
    if (recipients.length === 0) {
      // Nobody subscribes to this digest, so the queue would grow forever.
      await markDigestEventsSent(events.map((e) => e.id));
      return {
        status: 'skipped',
        count: 0,
        attempted: 0,
        jobs: lines.length,
        reason: 'No subscribed recipients.',
      };
    }

    const dayLabel = digestDay(new Date());
    const body = lines.map(digestLine);
    const sent = await deliverEach(recipients, (r) => render(r, dayLabel, body), loaded.cfg);
    if (sent === 0) {
      return {
        status: 'error',
        count: 0,
        attempted: recipients.length,
        jobs: lines.length,
        reason: `Every ${label} digest email failed to send; see server logs.`,
      };
    }
    // Reported: this digest named them, so no later one should.
    await markDigestEventsSent(events.map((e) => e.id));
    return { status: 'sent', count: sent, attempted: recipients.length, jobs: lines.length };
  } catch (err) {
    // Best-effort: the scheduler must never crash over an email problem.
    console.error(`[email] ${label} digest failed:`, err);
    return { status: 'error', count: 0, attempted: 0, jobs: 0, reason: (err as Error).message };
  }
}

/** SCHEDULED: the day's sold work — quotes marked sold and moved to projects. */
export async function sendSoldWorkDigest(): Promise<SendDigestResult> {
  return sendDigest(
    'new_project',
    newProjectRecipients,
    buildSoldWorkDigestEmail,
    // A sold job stays sold: nothing about the project can make the sale untrue.
    () => true,
    'sold-work'
  );
}

/** SCHEDULED: the day's completed jobs. */
export async function sendCompletedJobsDigest(): Promise<SendDigestResult> {
  return sendDigest(
    'job_completed',
    completionRecipients,
    buildCompletedJobsDigestEmail,
    // Reopened since it was queued — don't report a job as finished when it isn't.
    (e) => e.status === 'completed',
    'completed-jobs'
  );
}

/* ------------------------------------------------- On demand: schedule send */

export interface SendScheduleResult extends SendResult {
  /** Assignees with work in the range who couldn't be emailed, and why. */
  skipped: { name: string; reason: string }[];
  /** Jobs the send covered — the ones worth marking published. */
  projectIds?: number[];
  /** The range actually sent, which publishing works out for itself. */
  range?: { from: string; to: string };
}

/** Who to email, and about which days. */
export interface SendScheduleOptions {
  /** First day to cover. Omitted, it starts at the earliest day still ahead. */
  from?: string | null;
  /** Last day to cover. Omitted, it runs to the last day booked. */
  to?: string | null;
  includeSubs?: boolean;
  /** Only these jobs, which is how publishing scopes a send. */
  projectIds?: number[] | null;
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
 * ON PUBLISH: the crew is told the dates. Each assignee gets one email covering
 * only their own work, so recipients come from the bookings themselves rather
 * than the flag-based subscription lists (the same way the password-reset and
 * welcome sends address a known person).
 *
 * This is the only schedule send in the app, and publishing is the only thing
 * that calls it — editing and saving the schedule never emails anybody.
 *
 * Scope comes from the jobs being published: pass `projectIds` and the range
 * works itself out from what those jobs have booked, from today forward, since
 * days already worked aren't news. An explicit `from`/`to` overrides that.
 *
 * Best-effort per recipient, like every other send here: one unreachable
 * address never aborts the batch. Assignees with no address on file are
 * returned in `skipped` rather than silently dropped.
 */
export async function sendScheduleEmails(
  opts: SendScheduleOptions
): Promise<SendScheduleResult> {
  const includeSubs = opts.includeSubs ?? true;
  const onlyProjects = opts.projectIds?.length ? new Set(opts.projectIds) : null;
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
    // Crew notes ride along with the schedule: the whole point of them is that
    // the people working the job read them before they turn up.
    const crewNotes = await listCrewNotesForProjects([...new Set(tasks.map((t) => t.project_id))]);
    const notesByProject = new Map<number, string[]>();
    for (const n of crewNotes) {
      const list = notesByProject.get(n.project_id);
      if (list) list.push(n.body);
      else notesByProject.set(n.project_id, [n.body]);
    }
    const { windows } = computeSchedule(tasks, calendar);
    // Bookings are the days actually booked, so each line covers one unbroken
    // stretch: a two-week phase arrives as one line per week rather than one
    // that reads as if the weekend were a work day, and someone booked Mon and
    // Wed gets a line per day.
    const inScope = assigneeBookings(tasks, windows, calendar).filter(
      (w) => (includeSubs || w.kind === 'user') && (!onlyProjects || onlyProjects.has(w.projectId))
    );

    // The days to cover. Publishing doesn't name a range, so it takes the one
    // the work itself implies: everything these jobs still have ahead of them.
    const now = todayISO();
    const from =
      opts.from ??
      inScope.map((w) => w.start).sort().find((d) => d >= now) ??
      now;
    const to =
      opts.to ?? inScope.map((w) => w.end).sort().at(-1) ?? from;
    if (to < from) {
      return {
        status: 'sent',
        count: 0,
        attempted: 0,
        reason: 'Nothing is scheduled ahead for those jobs.',
        skipped,
        projectIds: [...new Set(inScope.map((w) => w.projectId))],
        range: { from, to },
      };
    }

    const booked = inScope.filter((w) => rangesOverlap(w.start, w.end, from, to));

    // Group each assignee's work, earliest first.
    const perAssignee = new Map<string, { name: string; lines: ScheduleLine[] }>();
    for (const w of [...booked].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))) {
      const entry = perAssignee.get(w.key) ?? { name: w.name, lines: [] };
      entry.lines.push({
        dates: scheduleSpan(w.start, w.end),
        shift: shiftLabel(w),
        project: w.projectName,
        phase: w.taskName,
        location: w.location,
        address: w.siteAddress,
        notes: w.taskNotes,
        crewNotes: notesByProject.get(w.projectId) ?? [],
      });
      perAssignee.set(w.key, entry);
    }

    const projectIds = [...new Set(booked.map((w) => w.projectId))];

    if (perAssignee.size === 0) {
      return {
        status: 'sent',
        count: 0,
        attempted: 0,
        reason: 'No one is booked on that work yet, so there was nobody to email.',
        skipped,
        projectIds,
        range: { from, to },
      };
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

    return { status: 'sent', count: sent, attempted, skipped, projectIds, range: { from, to } };
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
