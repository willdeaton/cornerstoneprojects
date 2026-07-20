'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser, VIEW_AS_COOKIE, type Role } from '@/lib/auth';

/**
 * Let an admin preview the app as a lower-privileged role (or return to their
 * own view). Passing 'admin' — the caller's real role — clears the preview.
 *
 * Security: the choice is gated on `realRole`, never the effective role, so an
 * admin who has previewed down to 'worker' can still switch back, and no
 * non-admin can ever use this to escalate.
 */
export async function setViewAsAction(role: Role) {
  const user = await getCurrentUser();
  if (!user || user.realRole !== 'admin') redirect('/dashboard');

  const jar = await cookies();
  if (role === 'manager' || role === 'worker') {
    jar.set(VIEW_AS_COOKIE, role, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  } else {
    // Any other value (i.e. 'admin') exits the preview.
    jar.delete(VIEW_AS_COOKIE);
  }

  // Land on the dashboard, which every role can reach, so switching never
  // strands the admin on a page their previewed role is redirected away from.
  redirect('/dashboard');
}
