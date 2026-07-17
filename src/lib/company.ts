import { DEFAULT_LOGO } from './branding';

/**
 * Company details shown on the printable / customer-facing quote.
 *
 * Kept as code constants (single source of truth) so the header renders the
 * same everywhere. Edit these values to change what customers see on a quote.
 */
export const COMPANY = {
  name: 'Cornerstone Facility Solutions',
  addressLines: ['123 Main Street', 'Suite 100', 'Your City, ST 00000'],
  phone: '(555) 555-0100',
  email: 'estimating@cornerstonefs.com',
  website: 'cornerstonefs.com',
  logo: DEFAULT_LOGO,
} as const;
