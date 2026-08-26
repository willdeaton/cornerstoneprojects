import 'server-only';
import type { Recipient } from './settings';

/*
 * ============================================================================
 *  EMAIL BODIES
 *
 *  This is the ONLY place email content is authored. Each function returns the
 *  subject line and the HTML body; the transport / gating live elsewhere.
 * ============================================================================
 */

export interface RenderedEmail {
  subject: string;
  html: string;
}

/* Shared inline styling helpers so every email reads as one system. */
const WRAP =
  'font-family:Arial,Helvetica,sans-serif;color:#1f2421;font-size:15px;line-height:1.5';
const MUTED = 'font-size:13px;color:#5b615c';
const SIGNOFF = `<p style="${MUTED}">— Cornerstone Facility Solutions</p>`;

/** Currency for dollar amounts shown in the body (whole-dollar, US). */
function money(n: number): string {
  return (n || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

/** Test email sent from the settings screen to the configured from_email. */
export function buildTestEmail(): RenderedEmail {
  return {
    subject: 'Cornerstone Project Tracker — test email',
    html: `
      <div style="${WRAP}">
        <p>This is a test email from the Cornerstone Project Tracker.</p>
        <p style="${MUTED}">If you received this, your sender identity and API key
        are configured correctly.</p>
        ${SIGNOFF}
      </div>
    `,
  };
}

/** One job in a daily digest — a sale won, or a job finished. */
export interface DigestJobLine {
  /** Pre-formatted day the event happened, e.g. "Tue, Aug 26". */
  day: string;
  project: string;
  customer: string;
  value: number;
  quoteNumber: string | null;
  category: string | null;
}

/**
 * The list half of a daily digest: one row per job, with the day it landed
 * (the digest reports every job still unreported, so a stretch where nothing
 * went out arrives as one email covering more than a single day). Job,
 * customer and category are all typed by hand, so every cell goes through
 * esc().
 */
function digestTable(lines: DigestJobLine[]): string {
  const th = `text-align:left;padding:8px 12px 8px 0;border-bottom:2px solid #1f2421;${MUTED};text-transform:uppercase;font-size:11px;letter-spacing:.04em`;
  const td = 'padding:10px 12px 10px 0;border-bottom:1px solid #e4e6e4;vertical-align:top';
  const head = ['Date', 'Job', 'Customer', 'Value']
    .map((h, i) => `<th style="${th}${i === 3 ? ';text-align:right;padding-right:0' : ''}">${h}</th>`)
    .join('');
  const body = lines
    .map(
      (l) => `
        <tr>
          <td style="${td};white-space:nowrap;${MUTED}">${esc(l.day)}</td>
          <td style="${td};font-weight:bold">
            ${esc(l.project)}
            ${l.quoteNumber ? `<br /><span style="font-weight:normal;${MUTED}">Quote ${esc(l.quoteNumber)}</span>` : ''}
          </td>
          <td style="${td}">
            ${esc(l.customer)}
            ${l.category ? `<br /><span style="${MUTED}">${esc(l.category)}</span>` : ''}
          </td>
          <td style="${td};text-align:right;padding-right:0;white-space:nowrap;font-weight:bold">${money(l.value)}</td>
        </tr>`
    )
    .join('');
  const total = lines.reduce((sum, l) => sum + (l.value || 0), 0);
  const foot = `
    <tr>
      <td style="padding:10px 12px 0 0;${MUTED}" colspan="3">Total</td>
      <td style="padding:10px 0 0;text-align:right;font-weight:bold;white-space:nowrap">${money(total)}</td>
    </tr>`;
  return `<table style="border-collapse:collapse;width:100%;margin:16px 0"><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table>`;
}

/** "3 jobs totaling $42,000" — the one-line summary above the list. */
function digestSummary(lines: DigestJobLine[]): string {
  const total = lines.reduce((sum, l) => sum + (l.value || 0), 0);
  const jobs = `${lines.length} ${lines.length === 1 ? 'job' : 'jobs'}`;
  return `${jobs} totaling ${money(total)}`;
}

/**
 * SCHEDULED (once a day): everything sold since the last digest, in one email.
 * Sent to everyone subscribed to new-project notifications — a running record
 * of what the pipeline won, rather than one email per quote converted.
 */
export function buildSoldWorkDigestEmail(
  recipient: Recipient,
  dayLabel: string,
  lines: DigestJobLine[]
): RenderedEmail {
  const hello = recipient.first_name ? `Hi ${esc(recipient.first_name)},` : 'Hi,';
  const summary = digestSummary(lines);
  return {
    subject: `Sold work — ${dayLabel} (${summary})`,
    html: `
      <div style="${WRAP}">
        <p>${hello}</p>
        <p>Here's the work we won: <strong>${summary}</strong> sold and moved
        into projects.</p>
        ${digestTable(lines)}
        <p style="${MUTED}">You're receiving this because you're subscribed to
        new-project notifications. It goes out once a day and covers everything
        sold since the last one.</p>
        ${SIGNOFF}
      </div>
    `,
  };
}

/**
 * SCHEDULED (once a day): every job marked complete since the last digest, in
 * one email. Sent to everyone subscribed to completion notifications.
 */
export function buildCompletedJobsDigestEmail(
  recipient: Recipient,
  dayLabel: string,
  lines: DigestJobLine[]
): RenderedEmail {
  const hello = recipient.first_name ? `Hi ${esc(recipient.first_name)},` : 'Hi,';
  const summary = digestSummary(lines);
  return {
    subject: `Jobs completed — ${dayLabel} (${summary})`,
    html: `
      <div style="${WRAP}">
        <p>${hello}</p>
        <p>Here's the work we finished: <strong>${summary}</strong> marked
        complete and ready to bill.</p>
        ${digestTable(lines)}
        <p style="${MUTED}">You're receiving this because you're subscribed to
        job-completion notifications. It goes out once a day and covers every
        job completed since the last one.</p>
        ${SIGNOFF}
      </div>
    `,
  };
}

/** One row of a schedule email: a stretch of work on one job. */
export interface ScheduleLine {
  /** Pre-formatted, e.g. "Mon, Mar 3 – Fri, Mar 7". */
  dates: string;
  /**
   * Pre-formatted shift — "All day", "Starts 7:00 AM", or "8:00 AM – 12:00 PM
   * · 4h" for a day shared with another job. Never null: a job the crew is on
   * for the whole day should say so rather than say nothing.
   */
  shift: string;
  project: string;
  phase: string;
  location: string | null;
  /** The full site address the crew drives to, when the job has one. */
  address: string | null;
  notes: string | null;
  /** Job-specific messages for the crew, newest first. */
  crewNotes: string[];
}

/** A tappable directions link for an address typed by hand. */
function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * A bordered table of scheduled work — the sibling of digestTable for lists.
 * Job names, phase names and notes are all typed by hand, so every field goes
 * through esc() before it reaches the body.
 */
function scheduleTable(lines: ScheduleLine[]): string {
  const head = ['Dates', 'Job', 'Work']
    .map(
      (h) =>
        `<th style="text-align:left;padding:8px 12px 8px 0;border-bottom:2px solid #1f2421;${MUTED};text-transform:uppercase;font-size:11px;letter-spacing:.04em">${h}</th>`
    )
    .join('');
  const body = lines
    .map(
      (l) => `
        <tr>
          <td style="padding:10px 12px 10px 0;border-bottom:1px solid #e4e6e4;vertical-align:top;white-space:nowrap;font-weight:bold">
            ${esc(l.dates)}
            ${l.shift ? `<br /><span style="color:#4a7a2b">${esc(l.shift)}</span>` : ''}
          </td>
          <td style="padding:10px 12px 10px 0;border-bottom:1px solid #e4e6e4;vertical-align:top">
            ${esc(l.project)}
            ${l.address ? `<br /><a href="${mapsUrl(l.address)}" style="color:#4a7a2b">${esc(l.address)}</a>` : ''}
            ${l.location && l.location !== l.address ? `<br /><span style="${MUTED}">${esc(l.location)}</span>` : ''}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #e4e6e4;vertical-align:top">
            ${esc(l.phase)}
            ${l.notes ? `<br /><span style="${MUTED}">${esc(l.notes)}</span>` : ''}
            ${l.crewNotes
              .map(
                (n) =>
                  `<br /><span style="color:#1f2421">Note: ${esc(n)}</span>`
              )
              .join('')}
          </td>
        </tr>`
    )
    .join('');
  return `<table style="border-collapse:collapse;width:100%;margin:16px 0"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * SENT ON DEMAND: a manager sends out the schedule for a date range. Each
 * employee (and optionally each sub) gets only their own work. Recipients are
 * whoever is assigned in the range — not the flag-based subscription lists.
 */
export function buildScheduleEmail(
  firstName: string,
  range: { from: string; to: string },
  lines: ScheduleLine[]
): RenderedEmail {
  const hello = firstName ? `Hi ${esc(firstName)},` : 'Hi,';
  const span = esc(`${range.from} – ${range.to}`);
  return {
    subject: `Your schedule: ${span}`,
    html: `
      <div style="${WRAP}">
        <p>${hello}</p>
        <p>Here's your schedule for <strong>${span}</strong>:</p>
        ${scheduleTable(lines)}
        <p style="${MUTED}">Start times and addresses are shown where they're set —
        tap an address for directions. Dates can shift as jobs move: this is the
        plan as of today, so check with your manager before making travel plans
        around it.</p>
        ${SIGNOFF}
      </div>
    `,
  };
}

/** EVENT-DRIVEN: an admin created a new account. Sent to the new user. */
export function buildWelcomeEmail(
  firstName: string,
  loginEmail: string,
  loginUrl: string
): RenderedEmail {
  const hello = firstName ? `Hi ${firstName},` : 'Hi,';
  return {
    subject: 'Welcome to the Cornerstone Project Tracker',
    html: `
      <div style="${WRAP}">
        <p>${hello}</p>
        <p>An account has been created for you on the Cornerstone Project
        Tracker. Sign in with the email address
        <strong>${loginEmail}</strong> and the temporary password your
        administrator gave you.</p>
        <p style="margin:24px 0">
          <a href="${loginUrl}"
             style="background:#7ab648;color:#1f2421;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;display:inline-block">
            Sign in
          </a>
        </p>
        <p style="${MUTED}">
          If the button doesn't work, copy and paste this link into your browser:<br />
          <a href="${loginUrl}" style="color:#4a7a2b">${loginUrl}</a>
        </p>
        <p style="${MUTED}">
          Once you're in, we recommend setting a password of your own — use
          &ldquo;Forgot password&rdquo; on the sign-in page at any time.
        </p>
        ${SIGNOFF}
      </div>
    `,
  };
}

/** One direct report's week, as shown in the Monday approval email. */
export interface ApprovalReportSummary {
  user_name: string;
  /** Net hours per day, Monday..Sunday (7 entries). */
  days: { date: string; hours: number }[];
  total_hours: number;
  notes: string[];
}

/** Escape user-entered text (names, shift notes) interpolated into email HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Short weekday + date header cell, e.g. "Mon 2/9". */
function dayHeader(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const wd = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${wd} ${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * SCHEDULED (Monday morning): one email per manager summarizing every direct
 * report's prior week — day-by-day net hours and the weekly total — with a
 * tokenized link to approve the hours without logging in.
 */
export function renderWeeklyApprovalEmail(
  managerName: string,
  weekLabel: string,
  reports: ApprovalReportSummary[],
  approveUrl: string
): RenderedEmail {
  const firstName = (managerName || '').trim().split(/\s+/)[0] || '';
  const hello = firstName ? `Hi ${esc(firstName)},` : 'Hi,';

  const th = `padding:6px 8px;${MUTED};text-align:right;border-bottom:1px solid #e2e5e2;white-space:nowrap`;
  const td = 'padding:6px 8px;text-align:right;color:#1f2421;border-bottom:1px solid #eef0ee';

  const sections = reports
    .map((r) => {
      if (r.total_hours <= 0) {
        return `
          <div style="margin:20px 0">
            <p style="margin:0 0 4px;font-weight:bold;color:#1f2421">${esc(r.user_name)}</p>
            <p style="margin:0;${MUTED}">No time recorded.</p>
          </div>`;
      }
      const headCells = r.days.map((d) => `<th style="${th}">${dayHeader(d.date)}</th>`).join('');
      const hourCells = r.days
        .map((d) => `<td style="${td}">${d.hours > 0 ? d.hours.toFixed(1) : '—'}</td>`)
        .join('');
      const notes = r.notes.length
        ? `<p style="margin:6px 0 0;${MUTED}">Notes: ${r.notes.map(esc).join(' · ')}</p>`
        : '';
      return `
        <div style="margin:20px 0">
          <p style="margin:0 0 6px;font-weight:bold;color:#1f2421">
            ${esc(r.user_name)}
            <span style="font-weight:normal;${MUTED}"> — ${r.total_hours.toFixed(1)} hours</span>
          </p>
          <table style="border-collapse:collapse;font-size:13px">
            <tr>${headCells}<th style="${th}">Total</th></tr>
            <tr>${hourCells}<td style="${td};font-weight:bold">${r.total_hours.toFixed(1)}</td></tr>
          </table>
          ${notes}
        </div>`;
    })
    .join('');

  return {
    subject: `Time approval needed — week of ${weekLabel}`,
    html: `
      <div style="${WRAP}">
        <p>${hello}</p>
        <p>Here are your team's hours for the week of <strong>${weekLabel}</strong>.
        Please review and approve them for payroll.</p>
        ${sections}
        <p style="margin:24px 0">
          <a href="${approveUrl}"
             style="background:#7ab648;color:#1f2421;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;display:inline-block">
            Review &amp; approve hours
          </a>
        </p>
        <p style="${MUTED}">
          If the button doesn't work, copy and paste this link into your browser:<br />
          <a href="${approveUrl}" style="color:#4a7a2b">${approveUrl}</a>
        </p>
        <p style="${MUTED}">No login needed — this link is unique to you and expires in 14 days.</p>
        ${SIGNOFF}
      </div>
    `,
  };
}

/** EVENT-DRIVEN: a user requested a password reset link. */
export function buildPasswordResetEmail(firstName: string, resetUrl: string): RenderedEmail {
  const hello = firstName ? `Hi ${firstName},` : 'Hi,';
  return {
    subject: 'Reset your Cornerstone Project Tracker password',
    html: `
      <div style="${WRAP}">
        <p>${hello}</p>
        <p>We received a request to reset the password for your Cornerstone
        Project Tracker account. Click the button below to choose a new
        password. This link expires in 1 hour.</p>
        <p style="margin:24px 0">
          <a href="${resetUrl}"
             style="background:#7ab648;color:#1f2421;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;display:inline-block">
            Reset password
          </a>
        </p>
        <p style="${MUTED}">
          If the button doesn't work, copy and paste this link into your browser:<br />
          <a href="${resetUrl}" style="color:#4a7a2b">${resetUrl}</a>
        </p>
        <p style="${MUTED}">
          If you didn't request this, you can safely ignore this email — your
          password won't change.
        </p>
        ${SIGNOFF}
      </div>
    `,
  };
}
