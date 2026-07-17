import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCompanySettings, saveCompanySettings } from '@/lib/company';

export const runtime = 'nodejs';

async function requireManager() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (user.role !== 'admin' && user.role !== 'manager') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user };
}

/** GET — company details shown on customer-facing quotes. */
export async function GET() {
  const { error } = await requireManager();
  if (error) return error;
  const settings = await getCompanySettings();
  return NextResponse.json({ settings });
}

/** PUT — save company details (guarded behind admin/manager). */
export async function PUT(req: Request) {
  const { error } = await requireManager();
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
  const saved = await saveCompanySettings({
    name: str(body.name),
    // Address is multi-line: trim outer whitespace but keep the line breaks.
    address: typeof body.address === 'string' ? body.address.trim() : undefined,
    phone: str(body.phone),
    email: str(body.email),
    website: str(body.website),
  });
  return NextResponse.json({ settings: saved });
}
