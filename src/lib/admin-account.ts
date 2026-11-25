import 'server-only';
import type { Pool } from 'pg';
import bcrypt from 'bcryptjs';

/*
 * Admin account from the environment.
 *
 * Staging / hosted deploys set ADMIN_EMAIL and ADMIN_PASSWORD (and optionally
 * ADMIN_NAME) on the app service, and the app guarantees that account exists
 * with the admin role every time it boots. That way nobody has to know the
 * seed defaults, and a database that was seeded long ago still gets the
 * account the operator configured.
 *
 *   - Both ADMIN_EMAIL and ADMIN_PASSWORD must be set; otherwise nothing runs.
 *   - If no user has that email, one is created as an active admin.
 *   - If one exists, its password is reset to ADMIN_PASSWORD, its role is set
 *     to admin and it is reactivated. The env vars are the source of truth, so
 *     changing the password in the UI only lasts until the next restart.
 *
 * The login screen signs in by email address, so ADMIN_EMAIL is the username.
 */

export interface AdminAccountConfig {
  email: string;
  password: string;
  name: string;
}

const MIN_PASSWORD_LENGTH = 6;
const DEFAULT_NAME = 'Administrator';

/** Read the admin account from the environment, or null when not configured. */
export function adminAccountFromEnv(env: NodeJS.ProcessEnv = process.env): AdminAccountConfig | null {
  const email = (env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = env.ADMIN_PASSWORD ?? '';
  if (!email && !password) return null;

  if (!email || !password) {
    console.warn('[admin] ADMIN_EMAIL and ADMIN_PASSWORD must both be set; admin account not configured.');
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.warn('[admin] ADMIN_EMAIL is not a valid email address; admin account not configured.');
    return null;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.warn(`[admin] ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters; admin account not configured.`);
    return null;
  }

  const name = (env.ADMIN_NAME ?? '').trim() || DEFAULT_NAME;
  return { email, password, name };
}

/**
 * Create or update the configured admin account. Safe to run on every boot;
 * does nothing when the environment doesn't configure one.
 */
export async function ensureAdminAccount(pool: Pool, config = adminAccountFromEnv()): Promise<void> {
  if (!config) return;

  const { rows } = await pool.query<{ id: number }>('SELECT id FROM users WHERE email = $1', [
    config.email,
  ]);
  const hash = bcrypt.hashSync(config.password, 10);

  if (rows[0]) {
    await pool.query(
      `UPDATE users SET password_hash = $1, role = 'admin', active = 1 WHERE id = $2`,
      [hash, rows[0].id]
    );
    console.log(`[admin] updated admin account ${config.email}`);
    return;
  }

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, active) VALUES ($1, $2, $3, 'admin', 1)`,
    [config.name, config.email, hash]
  );
  console.log(`[admin] created admin account ${config.email}`);
}
