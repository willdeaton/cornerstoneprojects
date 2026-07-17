import 'server-only';
import { getDb } from './db';
import { DEFAULT_LOGO } from './branding';

/**
 * Uploaded branding logos.
 *
 * Logos are stored as base64 `data:` URLs in the generic key/value `settings`
 * table (the same approach used for project file uploads), so no filesystem
 * writes are needed and the images survive on any hosted Postgres.
 *
 * Three independent slots:
 *   - full     : the wide logo shown in the app sidebar and sign-in screen.
 *   - icon     : a square mark shown when the sidebar is collapsed.
 *   - estimate : the logo printed on customer-facing quote / estimate PDFs.
 *
 * Any slot left empty falls back sensibly (see getBranding()).
 */
export type LogoKind = 'full' | 'icon' | 'estimate';

const KEY: Record<LogoKind, string> = {
  full: 'logo_full',
  icon: 'logo_icon',
  estimate: 'logo_estimate',
};

export interface Branding {
  /** Wide sidebar / login logo. Falls back to the committed default file. */
  full: string;
  /** Square collapsed-sidebar mark, or null when none is uploaded. */
  icon: string | null;
  /** Estimate PDF logo. Falls back to the full logo. */
  estimate: string;
}

/** Read all three logo slots in one query, applying fallbacks. */
export async function getBranding(): Promise<Branding> {
  const db = await getDb();
  const { rows } = await db.query(
    'SELECT key, value FROM settings WHERE key = ANY($1)',
    [[KEY.full, KEY.icon, KEY.estimate]]
  );
  const map = new Map(rows.map((r) => [r.key as string, r.value as string]));
  const full = map.get(KEY.full) || DEFAULT_LOGO;
  return {
    full,
    icon: map.get(KEY.icon) || null,
    estimate: map.get(KEY.estimate) || full,
  };
}

/** Upsert (dataUrl) or clear (null) a single logo slot. */
export async function setLogo(kind: LogoKind, dataUrl: string | null): Promise<void> {
  const db = await getDb();
  const key = KEY[kind];
  if (dataUrl === null) {
    await db.query('DELETE FROM settings WHERE key = $1', [key]);
    return;
  }
  await db.query(
    `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, dataUrl]
  );
}
