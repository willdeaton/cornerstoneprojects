/**
 * Quote numbers are generated from the customer's three-letter code and the
 * quote's issue date: `XXXMMDDYY` (e.g. ARH082526 for ARH on 2026-08-25).
 *
 * The pieces live here so the builder (which previews the number as you fill
 * the form) and the server (which makes it unique before saving) always agree
 * on the format.
 */

/** Exactly three letters, no digits or punctuation. */
export const ABBREVIATION_LENGTH = 3;

/** Normalize typed input to the stored form: uppercase, letters only. */
export function normalizeAbbreviation(value: string | null | undefined): string {
  return (value ?? '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, ABBREVIATION_LENGTH);
}

/** True when `value` is a usable customer code — exactly three letters. */
export function isValidAbbreviation(value: string | null | undefined): boolean {
  return new RegExp(`^[A-Z]{${ABBREVIATION_LENGTH}}$`).test(normalizeAbbreviation(value));
}

/**
 * `XXXMMDDYY` for a customer code and a YYYY-MM-DD date, or `null` when either
 * is missing or malformed — the caller then leaves the quote number to be typed
 * by hand.
 */
export function quoteNumberBase(
  abbreviation: string | null | undefined,
  isoDate: string | null | undefined
): string | null {
  const code = normalizeAbbreviation(abbreviation);
  if (!isValidAbbreviation(code)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((isoDate ?? '').trim());
  if (!m) return null;
  const [, year, month, day] = m;
  return `${code}${month}${day}${year.slice(2)}`;
}
