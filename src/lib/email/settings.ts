import 'server-only';
import { getDb } from '../db';
import type { EmailConfig } from './transport';

/*
 * Email settings CRUD, the shared recipient resolver, and the atomic
 * single-statement run-lock helpers for scheduled jobs.
 */

/** Masked sentinel returned to (and ignored from) the client for secret fields. */
export const SECRET_MASK = '••••••••';

/** The per-user boolean subscription flags this app supports. */
export const EMAIL_FLAGS = [
  'receives_project_reminders',
  'receives_completion_report',
  'receives_schedule_change_emails',
] as const;

export type EmailFlag = (typeof EMAIL_FLAGS)[number];

export interface EmailSettings extends EmailConfig {
  id: number;
  // Legacy SMTP fields — retained but not used for delivery.
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_password: string | null;
  updated_at: string;
}

export interface Recipient {
  email: string;
  first_name: string;
}

/* -------------------------------------------------------- Settings upsert */

/** Read the singleton settings row (guaranteed to exist after migrate()). */
export async function getEmailSettings(): Promise<EmailSettings> {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM email_settings WHERE id = 1');
  return rows[0] as EmailSettings;
}

export interface EmailSettingsInput {
  from_name?: string;
  from_email?: string;
  // Secret-ish legacy field; only overwritten when a real value comes in.
  smtp_password?: string | null;
}

/**
 * Upsert the singleton settings row. A secret-ish field is only overwritten
 * when the incoming value is truthy AND not the masked sentinel — so
 * re-saving the form (which echoes the mask) never wipes a stored value.
 */
export async function saveEmailSettings(input: EmailSettingsInput): Promise<EmailSettings> {
  const db = await getDb();
  const secretIsReal =
    typeof input.smtp_password === 'string' &&
    input.smtp_password.length > 0 &&
    input.smtp_password !== SECRET_MASK;

  const { rows } = await db.query(
    `UPDATE email_settings
        SET from_name  = COALESCE($1, from_name),
            from_email = COALESCE($2, from_email),
            smtp_password = CASE WHEN $3::boolean THEN $4 ELSE smtp_password END,
            updated_at = now()
      WHERE id = 1
      RETURNING *`,
    [
      input.from_name ?? null,
      input.from_email ?? null,
      secretIsReal,
      secretIsReal ? input.smtp_password : null,
    ]
  );
  return rows[0] as EmailSettings;
}

/** Settings for the API/GET response, with secret fields masked. */
export function maskSettings(s: EmailSettings): Omit<EmailSettings, 'smtp_password'> & {
  smtp_password: string;
} {
  return { ...s, smtp_password: s.smtp_password ? SECRET_MASK : '' };
}

/* ------------------------------------------------------- Recipient resolver */

/**
 * Active users who (a) carry the given boolean flag AND (b) have a resolvable
 * address. Email resolution falls back personal_email -> work_email -> email.
 */
export async function recipientsWithFlag(flag: EmailFlag): Promise<Recipient[]> {
  // Guard: flag is interpolated into SQL, so it must be a known column.
  if (!EMAIL_FLAGS.includes(flag)) {
    throw new Error(`Unknown email flag: ${flag}`);
  }
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT name, personal_email, work_email, email
       FROM users
      WHERE active = 1 AND ${flag} = true`
  );
  const out: Recipient[] = [];
  for (const r of rows as {
    name: string;
    personal_email: string | null;
    work_email: string | null;
    email: string | null;
  }[]) {
    const email = r.personal_email || r.work_email || r.email;
    if (!email) continue;
    out.push({ email, first_name: (r.name || '').trim().split(/\s+/)[0] || '' });
  }
  return out;
}

/* thin per-type wrappers */
export const projectReminderRecipients = () => recipientsWithFlag('receives_project_reminders');
export const completionReportRecipients = () => recipientsWithFlag('receives_completion_report');
export const scheduleChangeRecipients = () => recipientsWithFlag('receives_schedule_change_emails');

/* --------------------------------------------------- Scheduled-job run locks */

type LockTable = 'project_reminder_run_lock' | 'completion_report_run_lock';

/**
 * Atomically claim a scheduled job's singleton lock. Returns true only if this
 * caller won the race (rowcount > 0), i.e. no other worker ran within the gap.
 */
async function tryAcquireLock(table: LockTable, minGapMinutes: number): Promise<boolean> {
  const db = await getDb();
  const res = await db.query(
    `UPDATE ${table}
        SET last_run_at = now(), last_status = 'running'
      WHERE id = 1
        AND (last_run_at IS NULL
             OR last_run_at < now() - ($1 || ' minutes')::interval)`,
    [String(minGapMinutes)]
  );
  return (res.rowCount ?? 0) > 0;
}

async function markRun(table: LockTable, status: string): Promise<void> {
  const db = await getDb();
  await db.query(`UPDATE ${table} SET last_status = $1 WHERE id = 1`, [status]);
}

export const tryAcquireProjectReminderLock = (minGap: number) =>
  tryAcquireLock('project_reminder_run_lock', minGap);
export const markProjectReminderRun = (status: string) =>
  markRun('project_reminder_run_lock', status);

export const tryAcquireCompletionReportLock = (minGap: number) =>
  tryAcquireLock('completion_report_run_lock', minGap);
export const markCompletionReportRun = (status: string) =>
  markRun('completion_report_run_lock', status);
