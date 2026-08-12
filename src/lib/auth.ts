import 'server-only';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb } from './db';

export const SESSION_COOKIE = 'cs_session';
/** Cookie holding the role an admin has chosen to preview the app as. */
export const VIEW_AS_COOKIE = 'cs_view_as';
const SESSION_DAYS = 30;

export type Role = 'admin' | 'manager' | 'worker' | 'employee';

export interface User {
  id: number;
  name: string;
  email: string;
  /** Effective role used for every access check — equals `realRole` unless an
   *  admin is previewing the app as a lower-privileged role. */
  role: Role;
  active: number;
  created_at: string;
  /** The user's actual role from the database (unaffected by previewing). */
  realRole?: Role;
  /** The role an admin is currently previewing as, or null when not previewing. */
  viewingAs?: Role | null;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

/** Validate credentials; returns the user row (without hash) or null. */
export async function authenticate(email: string, password: string): Promise<User | null> {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1 AND active = 1', [
    email.trim().toLowerCase(),
  ]);
  const row = rows[0] as (User & { password_hash: string }) | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  const { password_hash, ...user } = row;
  return user;
}

/** Create a session row and set the cookie. */
export async function createSession(userId: number): Promise<void> {
  const db = await getDb();
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [
    token,
    userId,
    expires.toISOString(),
  ]);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.query('DELETE FROM sessions WHERE token = $1', [token]);
    jar.delete(SESSION_COOKIE);
  }
}

/** Resolve the currently logged-in user from the session cookie, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now() AND u.active = 1`,
    [token]
  );
  const user = (rows[0] as User) ?? null;
  if (!user) return null;

  // Record the real role and default to "not previewing".
  user.realRole = user.role;
  user.viewingAs = null;

  // Only an admin may preview the app as a lower-privileged role, and only ever
  // *downgrade* to 'manager', 'worker' or 'employee'. The effective `role` is
  // swapped so every existing access gate (nav, page redirects, server actions)
  // honours the preview automatically, while `realRole` keeps the true identity
  // so the admin can always switch back.
  if (user.role === 'admin') {
    const previewed = jar.get(VIEW_AS_COOKIE)?.value;
    if (previewed === 'manager' || previewed === 'worker' || previewed === 'employee') {
      user.viewingAs = previewed;
      user.role = previewed;
    }
  }

  return user;
}
