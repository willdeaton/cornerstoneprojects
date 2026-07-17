import 'server-only';
import type { Recipient } from './settings';
import type { Project } from '../types';

/*
 * ============================================================================
 *  EMAIL BODY PLACEHOLDERS
 *
 *  These are intentionally STUBBED. Each function returns the subject line and
 *  a minimal HTML body so the mechanism (transport, gating, scheduling) works
 *  end-to-end. Fill in the real subject + HTML copy here — this is the only
 *  place email content is authored.
 * ============================================================================
 */

export interface RenderedEmail {
  subject: string;
  html: string;
}

/** Test email sent from the settings screen to the configured from_email. */
export function buildTestEmail(): RenderedEmail {
  // TODO: replace with real test-email copy.
  return {
    subject: '[PLACEHOLDER] Cornerstone test email',
    html: '<p>PLACEHOLDER — this is a test email from the Cornerstone Project Tracker.</p>',
  };
}

/** SCHEDULED: weekly reminder about active / overdue projects. */
export function buildProjectReminderEmail(
  recipient: Recipient,
  projects: Project[]
): RenderedEmail {
  // TODO: replace with real reminder copy (list of open/overdue projects, etc.).
  return {
    subject: '[PLACEHOLDER] Project reminder',
    html: `<p>PLACEHOLDER reminder for ${recipient.first_name || 'there'} — ${projects.length} active project(s).</p>`,
  };
}

/** SCHEDULED: periodic project status report (may carry an attachment). */
export function buildCompletionReportEmail(
  recipient: Recipient,
  projects: Project[]
): RenderedEmail {
  // TODO: replace with real report copy.
  return {
    subject: '[PLACEHOLDER] Project status report',
    html: `<p>PLACEHOLDER status report for ${recipient.first_name || 'there'} — ${projects.length} project(s).</p>`,
  };
}

/** EVENT-DRIVEN: a user requested a password reset link. */
export function buildPasswordResetEmail(firstName: string, resetUrl: string): RenderedEmail {
  const hello = firstName ? `Hi ${firstName},` : 'Hi,';
  return {
    subject: 'Reset your Cornerstone Project Tracker password',
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2421;font-size:15px;line-height:1.5">
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
        <p style="font-size:13px;color:#5b615c">
          If the button doesn't work, copy and paste this link into your browser:<br />
          <a href="${resetUrl}" style="color:#4a7a2b">${resetUrl}</a>
        </p>
        <p style="font-size:13px;color:#5b615c">
          If you didn't request this, you can safely ignore this email — your
          password won't change.
        </p>
        <p style="font-size:13px;color:#5b615c">— Cornerstone Facility Solutions</p>
      </div>
    `,
  };
}

/** EVENT-DRIVEN: a project's schedule/status changed. */
export function buildScheduleChangeEmail(
  recipient: Recipient,
  project: Project
): RenderedEmail {
  // TODO: replace with real change-notification copy (what changed, new dates).
  return {
    subject: '[PLACEHOLDER] Project schedule changed',
    html: `<p>PLACEHOLDER — schedule changed for "${project.name}".</p>`,
  };
}
