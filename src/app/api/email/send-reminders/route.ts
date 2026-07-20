import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { sendProjectReminders } from '@/lib/email/send';

export const runtime = 'nodejs';

/** POST — manually fire project reminders now, bypassing the debounce gap. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // min_gap_minutes = 0 bypasses the run-lock debounce for a manual trigger.
  const result = await sendProjectReminders(0);
  return NextResponse.json({ ok: result.status !== 'error', result });
}
