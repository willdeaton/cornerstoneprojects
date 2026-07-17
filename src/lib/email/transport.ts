import 'server-only';

/*
 * Email transport — the SINGLE choke point every send path funnels through.
 *
 * Uses the provider's HTTP API (SendGrid v3 /mail/send) rather than SMTP,
 * because many hosts block outbound port 587. The API key comes from the
 * SENDGRID_API_KEY env var and is NEVER stored in the database.
 */

/** Env var holding the provider API key. Never persisted to the DB. */
export const API_KEY_ENV = 'SENDGRID_API_KEY';
const SENDGRID_ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';
const TIMEOUT_MS = 15_000;

/** Thrown for any misconfiguration or provider-side failure. */
export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/** Sender identity, loaded from the singleton email_settings row. */
export interface EmailConfig {
  from_name: string;
  from_email: string;
}

/** Optional attachment. `content` must be base64-encoded (no data: prefix). */
export interface EmailAttachment {
  filename: string;
  content: string;
  type?: string;
}

/** True when the API key env var is present (non-empty). */
export function hasApiKey(): boolean {
  return !!process.env[API_KEY_ENV];
}

/**
 * Send one email through the provider HTTP API. ALL send paths call this.
 *
 * Hard requirements before anything is sent: the API key env var must be set
 * AND cfg.from_email must be non-empty — otherwise an EmailSendError is raised.
 */
export async function sendEmail(
  cfg: EmailConfig,
  toAddr: string,
  subject: string,
  htmlBody: string,
  attachments?: EmailAttachment[]
): Promise<void> {
  const apiKey = process.env[API_KEY_ENV];
  if (!apiKey) {
    throw new EmailSendError(`${API_KEY_ENV} is not set; cannot send email.`);
  }
  if (!cfg.from_email) {
    throw new EmailSendError('No from_email is configured in Email Settings.');
  }
  if (!toAddr) {
    throw new EmailSendError('No recipient address supplied.');
  }

  const payload: Record<string, unknown> = {
    personalizations: [{ to: [{ email: toAddr }] }],
    from: cfg.from_name
      ? { email: cfg.from_email, name: cfg.from_name }
      : { email: cfg.from_email },
    subject,
    content: [{ type: 'text/html', value: htmlBody }],
  };

  if (attachments && attachments.length > 0) {
    payload.attachments = attachments.map((a) => ({
      content: a.content,
      filename: a.filename,
      type: a.type ?? 'application/octet-stream',
      disposition: 'attachment',
    }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(SENDGRID_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError'
      ? `timed out after ${TIMEOUT_MS / 1000}s`
      : err instanceof Error
        ? err.message
        : String(err);
    throw new EmailSendError(`Email request to provider failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  // SendGrid returns 202 Accepted on success.
  if (!res.ok) {
    throw new EmailSendError(
      `Email provider returned ${res.status}: ${await parseProviderError(res)}`
    );
  }
}

/** Turn the provider's JSON error body into a single readable line. */
async function parseProviderError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { errors?: { message?: string; field?: string }[] };
    if (data?.errors?.length) {
      return data.errors
        .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
        .filter(Boolean)
        .join('; ');
    }
  } catch {
    // fall through to statusText
  }
  return res.statusText || 'unknown error';
}
