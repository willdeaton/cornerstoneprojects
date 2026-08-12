import 'server-only';
import type { Recipient } from './settings';
import type { Project } from '../types';

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

/** A small "label: value" detail table, omitting rows with no value. */
function detailTable(rows: [string, string | null | undefined][]): string {
  const cells = rows
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(
      ([label, v]) => `
        <tr>
          <td style="padding:4px 16px 4px 0;${MUTED};white-space:nowrap;vertical-align:top">${label}</td>
          <td style="padding:4px 0;font-weight:bold;color:#1f2421;vertical-align:top">${v}</td>
        </tr>`
    )
    .join('');
  return `<table style="border-collapse:collapse;margin:16px 0">${cells}</table>`;
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

/**
 * EVENT-DRIVEN: a quote was marked sold and converted into a project. Sent to
 * everyone subscribed to new-project notifications as a short status report on
 * the job that just entered the pipeline.
 */
export function buildNewProjectEmail(recipient: Recipient, project: Project): RenderedEmail {
  const hello = recipient.first_name ? `Hi ${recipient.first_name},` : 'Hi,';
  return {
    subject: `New project: ${project.name}`,
    html: `
      <div style="${WRAP}">
        <p>${hello}</p>
        <p>A quote was just marked <strong>sold</strong> and moved into projects.
        Here's the status of the new job:</p>
        ${detailTable([
          ['Project', project.name],
          ['Customer', project.customer],
          ['Value', money(project.value)],
          ['Quote #', project.quote_number],
          ['Category', project.category],
        ])}
        <p style="${MUTED}">You're receiving this because you're subscribed to
        new-project notifications.</p>
        ${SIGNOFF}
      </div>
    `,
  };
}

/**
 * EVENT-DRIVEN: a project was marked complete. Sent to everyone subscribed to
 * completion notifications.
 */
export function buildJobCompletedEmail(recipient: Recipient, project: Project): RenderedEmail {
  const hello = recipient.first_name ? `Hi ${recipient.first_name},` : 'Hi,';
  return {
    subject: `Job completed: ${project.name}`,
    html: `
      <div style="${WRAP}">
        <p>${hello}</p>
        <p>The following job has been marked <strong>complete</strong>:</p>
        ${detailTable([
          ['Project', project.name],
          ['Customer', project.customer],
          ['Value', money(project.value)],
          ['Quote #', project.quote_number],
          ['Category', project.category],
        ])}
        <p style="${MUTED}">You're receiving this because you're subscribed to
        job-completion notifications.</p>
        ${SIGNOFF}
      </div>
    `,
  };
}

/** One row of a schedule email: a stretch of work on one job. */
export interface ScheduleLine {
  /** Pre-formatted, e.g. "Mon, Mar 3 – Fri, Mar 7". */
  dates: string;
  project: string;
  phase: string;
  location: string | null;
  notes: string | null;
}

/** A bordered table of scheduled work — the sibling of detailTable for lists. */
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
          <td style="padding:10px 12px 10px 0;border-bottom:1px solid #e4e6e4;vertical-align:top;white-space:nowrap;font-weight:bold">${l.dates}</td>
          <td style="padding:10px 12px 10px 0;border-bottom:1px solid #e4e6e4;vertical-align:top">
            ${l.project}
            ${l.location ? `<br /><span style="${MUTED}">${l.location}</span>` : ''}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #e4e6e4;vertical-align:top">
            ${l.phase}
            ${l.notes ? `<br /><span style="${MUTED}">${l.notes}</span>` : ''}
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
  const hello = firstName ? `Hi ${firstName},` : 'Hi,';
  const span = `${range.from} – ${range.to}`;
  return {
    subject: `Your schedule: ${span}`,
    html: `
      <div style="${WRAP}">
        <p>${hello}</p>
        <p>Here's your schedule for <strong>${span}</strong>:</p>
        ${scheduleTable(lines)}
        <p style="${MUTED}">Dates can shift as jobs move — this is the plan as of
        today. Check with your manager before making travel plans around it.</p>
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
