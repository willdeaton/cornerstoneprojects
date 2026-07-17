import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { getDb } from './db';
import { hashPassword } from './auth';

/*
 * Self-service password reset.
 *
 * Flow:
 *   1. requestPasswordReset(email) — if an active user has that address,
 *      mint a random token, store only its SHA-256 hash with a short expiry,
 *      and return the RAW token so the caller can email a link. Returns null
 *      when there's no matching user (callers must NOT reveal which case it
 *      was, to avoid leaking which addresses are registered).
 *   2. resetPasswordWithToken(token, newPassword) — validate the token
 *      (exists, unused, unexpired), set the new password, mark the token used,
 *      and destroy all of that user's sessions so a compromised login can't
 *      linger.
 */

/** How long a reset link stays valid. */
const TOKEN_TTL_MINUTES = 60;

/** Minimum acceptable new-password length (mirrors the user-admin form). */
export const MIN_PASSWORD_LENGTH = 6;

/** Hash the raw token the same way going in and coming out. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface ResetRequest {
  token: string;
  user: { id: number; name: string; email: string };
}

/**
 * Create a reset token for the given email, or return null if no active user
 * matches. The returned `token` is the RAW value to embed in the emailed link;
 * only its hash is persisted.
 */
export async function requestPasswordReset(email: string): Promise<ResetRequest | null> {
  const db = await getDb();
  const { rows } = await db.query(
    'SELECT id, name, email FROM users WHERE email = $1 AND active = 1',
    [email.trim().toLowerCase()]
  );
  const user = rows[0] as { id: number; name: string; email: string } | undefined;
  if (!user) return null;

  // Invalidate any earlier outstanding tokens for this user so only the newest
  // link works.
  await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000);
  await db.query(
    'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), user.id, expires.toISOString()]
  );

  return { token, user };
}

/**
 * Consume a reset token and set the user's new password. Returns an object with
 * ok=false and a reason when the token is invalid/expired/used or the password
 * is too short; ok=true on success.
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: 'This reset link is invalid.' };
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const db = await getDb();
  const { rows } = await db.query(
    `SELECT user_id FROM password_reset_tokens
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hashToken(token)]
  );
  const row = rows[0] as { user_id: number } | undefined;
  if (!row) {
    return { ok: false, error: 'This reset link is invalid or has expired.' };
  }

  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
    hashPassword(newPassword),
    row.user_id,
  ]);
  await db.query('UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1', [
    hashToken(token),
  ]);
  // Force a fresh login everywhere after a reset.
  await db.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);

  return { ok: true };
}
