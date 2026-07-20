import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { sendTestEmail } from '@/lib/email/send';
import { EmailSendError } from '@/lib/email/transport';

export const runtime = 'nodejs';

/** POST — send a test message to the configured from_email. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await sendTestEmail();
    if (result.status !== 'sent') {
      return NextResponse.json({ error: result.reason ?? 'Could not send.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof EmailSendError ? err.message : 'Failed to send test email.';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
