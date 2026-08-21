/**
 * Shapes for the Settings → Backup export. Defined in their own module (no
 * `server-only` import) so both the server route that produces the payload and
 * the client panel that consumes it can share the same types.
 */
import type {
  Quote,
  QuoteLineItem,
  Project,
  ProjectInvoiceWithFile,
  Note,
  Customer,
  CustomerContact,
  PricingItem,
  Subcontractor,
  TaskStatus,
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

/**
 * One scheduled phase, flattened with its dates already resolved from the
 * dependency chain — the export carries the real dates, not the raw earliest
 * start, so a spreadsheet reader sees what the timeline showed.
 */
export interface BackupSchedulePhase {
  project_id: number;
  project_name: string;
  phase: string;
  start_date: string;
  end_date: string;
  working_days: number;
  status: TaskStatus;
  /** The daily start time as the crew sees it ("7:00 AM"), blank when unset. */
  start_time: string;
  /** Name of the phase this one follows, blank when it stands alone. */
  follows: string;
  /** The subcontractor carrying the phase, blank when it's our crew's work. */
  subcontractor: string;
  /** Our people needed per day, as planned on the timeline. */
  crew_needed: number;
  /** Crew-days booked out of the crew_needed x working_days budget. */
  crew_days_booked: number;
  /** Who is booked, with how many days each — "Dave Ruiz (3 days), …". */
  crew: string;
  notes: string | null;
}

/** Everything gathered for a date-range backup, before the client turns it
 *  into a workbook + PDFs + zip. */
export interface BackupData {
  quotes: BackupQuote[];
  projects: Project[];
  /** Invoice rows, each naming its attached PDF (the bytes are fetched from
   *  `/api/invoices/[id]/pdf`, like project files). */
  invoices: ProjectInvoiceWithFile[];
  notes: Note[];
  projectFiles: BackupProjectFile[];
  timeEntries: BackupTimeEntry[];
  customers: BackupCustomer[];
  pricing: PricingItem[];
  subcontractors: Subcontractor[];
  schedule: BackupSchedulePhase[];
}

/** The full API response: the gathered data plus context the client needs. */
export interface BackupPayload extends BackupData {
  range: { from: string; to: string };
  generatedAt: string;
  company: CompanyInfo;
}
