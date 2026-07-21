/**
 * Shapes for the Settings → Backup export. Defined in their own module (no
 * `server-only` import) so both the server route that produces the payload and
 * the client panel that consumes it can share the same types.
 */
import type {
  Quote,
  QuoteLineItem,
  Project,
  Note,
  Customer,
  CustomerContact,
  PricingItem,
} from './types';
// Type-only import — erased at compile time, so the `server-only` guard in
// company.ts never reaches the client bundle.
import type { CompanyInfo } from './company';

export type BackupQuote = Quote & { line_items: QuoteLineItem[] };
export type BackupCustomer = Customer & { contacts: CustomerContact[] };

/** A time entry flattened for export, with break-adjusted net hours. */
export interface BackupTimeEntry {
  id: number;
  user_id: number;
  user_name: string;
  project_id: number | null;
  project_name: string | null;
  customer: string | null;
  clock_in: string;
  clock_out: string | null;
  note: string | null;
  paid: boolean;
  break_minutes: number;
  net_hours: number;
}

/** Project file metadata only — the blob is fetched separately from
 *  `/api/files/[id]` so the JSON payload stays small. */
export interface BackupProjectFile {
  id: number;
  project_id: number;
  filename: string;
  mime: string | null;
  size: number;
  created_at: string;
}

/** Everything gathered for a date-range backup, before the client turns it
 *  into a workbook + PDFs + zip. */
export interface BackupData {
  quotes: BackupQuote[];
  projects: Project[];
  notes: Note[];
  projectFiles: BackupProjectFile[];
  timeEntries: BackupTimeEntry[];
  customers: BackupCustomer[];
  pricing: PricingItem[];
}

/** The full API response: the gathered data plus context the client needs. */
export interface BackupPayload extends BackupData {
  range: { from: string; to: string };
  generatedAt: string;
  company: CompanyInfo;
}
