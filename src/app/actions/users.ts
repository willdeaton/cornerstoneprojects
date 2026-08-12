'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser, hashPassword } from '@/lib/auth';
import type { Role } from '@/lib/auth';
import { sendWelcomeEmail } from '@/lib/email/send';
import { appOrigin } from '@/lib/app-origin';
import {
  createUserRow,
  updateUserEmailFields,
  emailExists,
  setUserRole,
  setUserActive,
  setUserPassword,
  setUserRate,
  deleteUser,
  countAdmins,
  getUserRole,
  setUserManager,
  getUserManagerInfo,
  managerChainContains,
  USER_EMAIL_FLAGS,
} from '@/lib/data';

const ROLES: Role[] = ['admin', 'manager', 'worker', 'employee'];

/** Pull the per-user email fields + subscription flags out of a form payload.
 *  Checkbox names map 1:1 to the DB boolean column names. */
function readEmailFields(formData: FormData) {
  const flags = Object.fromEntries(
    USER_EMAIL_FLAGS.map((f) => [f, formData.get(f) != null])
  ) as Record<(typeof USER_EMAIL_FLAGS)[number], boolean>;
  return {
    personal_email: String(formData.get('personal_email') ?? '').trim() || null,
    work_email: String(formData.get('work_email') ?? '').trim() || null,
    ...flags,
  };
}

/** Parse an hourly-rate input: empty = null (no rate), otherwise a
 *  non-negative dollar amount ("$" and "," are tolerated and stripped). */
function parseRate(raw: string): { ok: true; rate: number | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) return { ok: true, rate: null };
  const n = Number(s.replace(/[$,]/g, ''));
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'Hourly rate must be a non-negative number.' };
  }
  return { ok: true, rate: n };
}

async function requireManager() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new Error('Not authorized.');
  }
  return user;
}

export interface UserFormState {
  error?: string;
  success?: string;
}

/**
 * Check a proposed manager assignment. Returns an error message, or null when
 * the assignment is valid. `userId` is null when the report doesn't exist yet
 * (user creation), so self-assignment/cycles are impossible.
 */
async function validateManager(userId: number | null, managerId: number): Promise<string | null> {
  if (userId !== null && managerId === userId) {
    return 'A user cannot be their own manager.';
  }
  const manager = await getUserManagerInfo(managerId);
  if (!manager) return 'Selected manager does not exist.';
  if (!manager.active) return 'Selected manager is not an active user.';
  if (manager.role !== 'admin' && manager.role !== 'manager') {
    return 'Selected manager must have the admin or manager role.';
  }

  // Walk up the chain from the proposed manager; if the user being assigned
  // already appears above them, the assignment would create a reporting cycle.
  if (userId !== null && (await managerChainContains(managerId, userId))) {
    return 'That assignment would create a reporting cycle (the selected manager already reports up to this user).';
  }
  return null;
}

export async function createUserAction(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireManager();
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const role = String(formData.get('role') ?? 'worker') as Role;

  if (!name || !email || !password) return { error: 'All fields are required.' };
  if (password.length < 6) return { error: 'Password must be at least 6 characters.' };
  if (!ROLES.includes(role)) return { error: 'Invalid role.' };
  if (await emailExists(email)) return { error: 'A user with that email already exists.' };

  const managerRaw = String(formData.get('manager_id') ?? '').trim();
  let managerId: number | null = null;
  if (managerRaw) {
    managerId = Number(managerRaw);
    if (!Number.isInteger(managerId)) return { error: 'Invalid manager.' };
    const err = await validateManager(null, managerId);
    if (err) return { error: err };
  }

  const parsed = parseRate(String(formData.get('hourly_rate') ?? ''));
  if (!parsed.ok) return { error: parsed.error };

  const emailFields = readEmailFields(formData);
  await createUserRow({
    name,
    email,
    password_hash: hashPassword(password),
    role,
    manager_id: managerId,
    hourly_rate: parsed.rate,
    ...emailFields,
  });

  // Welcome the new user by email (best-effort — the account already exists).
  // Same address fallback the subscription emails use: personal -> work -> login.
  const to = emailFields.personal_email || emailFields.work_email || email;
  const firstName = name.split(/\s+/)[0] || '';
  const origin = await appOrigin();
  const sent = await sendWelcomeEmail(to, firstName, email, `${origin}/login`);

  revalidatePath('/settings/users');
  return {
    success:
      sent.status === 'sent'
        ? `Added ${name}. Welcome email sent to ${to}.`
        : `Added ${name}. (Welcome email not sent: ${sent.reason ?? 'unknown'})`,
  };
}

export async function updateUserSubscriptionsAction(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireManager();
  const id = Number(formData.get('id'));
  if (!id) return { error: 'Missing user id.' };
  await updateUserEmailFields(id, readEmailFields(formData));
  revalidatePath('/settings/users');
  return { success: 'Subscriptions updated.' };
}

export async function changeRoleAction(id: number, role: Role) {
  const me = await requireManager();
  if (!ROLES.includes(role)) return;
  // Don't allow removing the last admin.
  if ((await getUserRole(id)) === 'admin' && role !== 'admin' && (await countAdmins()) <= 1) {
    return;
  }
  // Only admins can grant admin.
  if (role === 'admin' && me.role !== 'admin') return;
  await setUserRole(id, role);
  revalidatePath('/settings/users');
}

export async function toggleActiveAction(id: number, active: boolean) {
  const me = await requireManager();
  if (id === me.id) return; // can't deactivate yourself
  if (!active && (await getUserRole(id)) === 'admin' && (await countAdmins()) <= 1) return;
  await setUserActive(id, active);
  revalidatePath('/settings/users');
}

export async function deleteUserAction(id: number): Promise<{ ok: boolean; error?: string }> {
  const me = await requireManager();
  if (id === me.id) return { ok: false, error: "You can't delete your own account." };
  // Never remove the last remaining admin.
  if ((await getUserRole(id)) === 'admin' && (await countAdmins()) <= 1) {
    return { ok: false, error: 'Cannot delete the last admin.' };
  }
  await deleteUser(id);
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function setUserManagerAction(
  userId: number,
  managerId: number | null
): Promise<{ ok: boolean; error?: string }> {
  await requireManager();
  if (!Number.isInteger(userId)) return { ok: false, error: 'Missing user id.' };
  if (!(await getUserManagerInfo(userId))) return { ok: false, error: 'User not found.' };
  if (managerId !== null) {
    if (!Number.isInteger(managerId)) return { ok: false, error: 'Invalid manager.' };
    const err = await validateManager(userId, managerId);
    if (err) return { ok: false, error: err };
  }
  await setUserManager(userId, managerId);
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function setUserRateAction(id: number, rateInput: string) {
  await requireManager();
  const parsed = parseRate(rateInput);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  await setUserRate(id, parsed.rate);
  revalidatePath('/settings/users');
  revalidatePath('/timesheets');
  return { ok: true };
}

export async function resetPasswordAction(id: number, password: string) {
  await requireManager();
  if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
  await setUserPassword(id, hashPassword(password));
  revalidatePath('/settings/users');
  return { ok: true };
}
