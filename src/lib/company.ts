import 'server-only';
import { getDb } from './db';
import { DEFAULT_LOGO } from './branding';

/**
 * Company details shown on the printable / customer-facing quote.
 *
 * These are edited in-app under **Settings → Company** and stored in a
 * singleton `company_settings` row, so the quote header/footer render the
 * same everywhere. The constants below are the fallback defaults (also used
 * to seed the row on first run) — edit the values in the app, not here.
 */
export interface CompanyInfo {
  name: string;
  addressLines: string[];
  phone: string;
  email: string;
  website: string;
  logo: string;
}

/** Fallback defaults, matching the row seeded in migrate(). */
export const COMPANY: CompanyInfo = {
  name: 'Cornerstone Facility Solutions',
  addressLines: ['123 Main Street', 'Suite 100', 'Your City, ST 00000'],
  phone: '(555) 555-0100',
  email: 'estimating@cornerstonefs.com',
  website: 'cornerstonefs.com',
  logo: DEFAULT_LOGO,
};

export interface CompanySettingsRow {
  name: string;
  address: string; // newline-separated address lines
  phone: string;
  email: string;
  website: string;
  updated_at: string;
}

/** Read the singleton settings row (guaranteed to exist after migrate()). */
export async function getCompanySettings(): Promise<CompanySettingsRow> {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM company_settings WHERE id = 1');
  return rows[0] as CompanySettingsRow;
}

/**
 * Company details for the quote, resolved from the DB with the hard-coded
 * constants as a safety net for any blank field.
 */
export async function getCompanyInfo(): Promise<CompanyInfo> {
  const row = await getCompanySettings();
  const addressLines = (row.address ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    name: row.name || COMPANY.name,
    addressLines: addressLines.length ? addressLines : COMPANY.addressLines,
    phone: row.phone || COMPANY.phone,
    email: row.email || COMPANY.email,
    website: row.website || COMPANY.website,
    logo: DEFAULT_LOGO,
  };
}

export interface CompanySettingsInput {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
}

/** Upsert the singleton settings row. Undefined fields are left unchanged. */
export async function saveCompanySettings(
  input: CompanySettingsInput
): Promise<CompanySettingsRow> {
  const db = await getDb();
  const { rows } = await db.query(
    `UPDATE company_settings
        SET name    = COALESCE($1, name),
            address = COALESCE($2, address),
            phone   = COALESCE($3, phone),
            email   = COALESCE($4, email),
            website = COALESCE($5, website),
            updated_at = now()
      WHERE id = 1
      RETURNING *`,
    [
      input.name ?? null,
      input.address ?? null,
      input.phone ?? null,
      input.email ?? null,
      input.website ?? null,
    ]
  );
  return rows[0] as CompanySettingsRow;
}
