import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { getDb } from './db';

/*
 * Tokenized approve-from-email links for weekly time approval.
 *
 * Modeled on the password-reset flow: the RAW token only ever lives in the
 * emailed link; the table stores its SHA-256 hash, so a leaked table can't be
 * used to approve anyone's hours. Differences from password reset:
 *   - Scope is (manager, week): the token authorizes ONE manager to approve
 *     their direct reports' hours for ONE Monday-start week.
 *   - MULTI-USE until expiry (no used_at): a manager may open the link and
 *     approve reports one at a time across several visits.
 *   - Issuing a new token for the same manager+week invalidates prior ones,
 *     so only the most recent email's link works.
 */

/** How long an approval link stays valid. */
const TOKEN_TTL_DAYS = 14;

/** Hash the raw token the same way going in and coming out. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Mint an approval token for one manager + week. Deletes any earlier tokens
 * for that pair, stores only the hash, and returns the RAW token for the link.
 */
export async function issueApprovalToken(managerId: number, weekStart: string): Promise<string> {
  const db = await getDb();
  await db.query(
    'DELETE FROM time_approval_tokens WHERE manager_id = $1 AND week_start = $2::date',
    [managerId, weekStart]
  );

  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 864e5);
  await db.query(
    `INSERT INTO time_approval_tokens (token_hash, manager_id, week_start, expires_at)
     VALUES ($1, $2, $3::date, $4)`,
    [hashToken(token), managerId, weekStart, expires.toISOString()]
  );
  return token;
}

/**
 * Resolve a raw token to its manager + week, or null when it's unknown or
 * expired. Deliberately does NOT consume the token (multi-use until expiry).
 */
export async function validateApprovalToken(
  rawToken: string
): Promise<{ managerId: number; weekStart: string } | null> {
  if (!rawToken) return null;
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT manager_id, to_char(week_start, 'YYYY-MM-DD') AS week_start
     FROM time_approval_tokens
     WHERE token_hash = $1 AND expires_at > now()`,
    [hashToken(rawToken)]
  );
  const row = rows[0] as { manager_id: number; week_start: string } | undefined;
  if (!row) return null;
  return { managerId: row.manager_id, weekStart: row.week_start };
}
