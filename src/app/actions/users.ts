'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser, hashPassword } from '@/lib/auth';
import type { Role } from '@/lib/auth';
import {
  createUserRow,
  updateUserEmailFields,
  emailExists,
  setUserRole,
  setUserActive,
  setUserPassword,
  countAdmins,
  getUserRole,
  USER_EMAIL_FLAGS,
} from '@/lib/data';

const ROLES: Role[] = ['admin', 'manager', 'worker'];

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

  await createUserRow({
    name,
    email,
    password_hash: hashPassword(password),
    role,
    ...readEmailFields(formData),
  });
  revalidatePath('/users');
  return { success: `Added ${name}.` };
}

export async function updateUserSubscriptionsAction(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireManager();
  const id = Number(formData.get('id'));
  if (!id) return { error: 'Missing user id.' };
  await updateUserEmailFields(id, readEmailFields(formData));
  revalidatePath('/users');
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
  revalidatePath('/users');
}

export async function toggleActiveAction(id: number, active: boolean) {
  const me = await requireManager();
  if (id === me.id) return; // can't deactivate yourself
  if (!active && (await getUserRole(id)) === 'admin' && (await countAdmins()) <= 1) return;
  await setUserActive(id, active);
  revalidatePath('/users');
}

export async function resetPasswordAction(id: number, password: string) {
  await requireManager();
  if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
  await setUserPassword(id, hashPassword(password));
  revalidatePath('/users');
  return { ok: true };
}
