import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getEmailSettings, saveEmailSettings, maskSettings } from '@/lib/email/settings';

export const runtime = 'nodejs';

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (user.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user };
}

/** GET — return settings with any secret field MASKED. */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  const settings = await getEmailSettings();
  return NextResponse.json({ settings: maskSettings(settings) });
}

/** PUT — save sender identity (guarded behind admin/manager). */
export async function PUT(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
  const saved = await saveEmailSettings({
    from_name: str(body.from_name),
    from_email: str(body.from_email),
    // Only overwritten when truthy and not the masked sentinel (see settings.ts).
    smtp_password: str(body.smtp_password),
  });
  return NextResponse.json({ settings: maskSettings(saved) });
}
