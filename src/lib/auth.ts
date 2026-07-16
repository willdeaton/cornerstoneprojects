import 'server-only';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb } from './db';

export const SESSION_COOKIE = 'cs_session';
const SESSION_DAYS = 30;

export type Role = 'admin' | 'manager' | 'worker';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: number;
  created_at: string;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

/** Validate credentials; returns the user row (without hash) or null. */
export function authenticate(email: string, password: string): User | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM users WHERE email = ? AND active = 1')
    .get(email.trim().toLowerCase()) as (User & { password_hash: string }) | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  const { password_hash, ...user } = row;
  return user;
}

/** Create a session row and set the cookie. */
export async function createSession(userId: number): Promise<void> {
  const db = getDb();
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, userId, expires.toISOString());
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
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
    jar.delete(SESSION_COOKIE);
  }
}

/** Resolve the currently logged-in user from the session cookie, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`
    )
    .get(token) as User | undefined;
  return row ?? null;
}
