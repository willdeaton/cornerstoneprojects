export type QuoteStatus = 'open' | 'sold' | 'lost';
export type ProjectStatus = 'not_started' | 'in_progress' | 'completed';

export interface Quote {
  id: number;
  quote_number: string | null;
  customer: string;
  project_name: string | null;
  category: string | null;
  bid_value: number;
  status: QuoteStatus;
  date_received: string | null;
  week_of: string | null;
  source: string;
  notes: string | null;
  // Customer-facing quote-document fields.
  customer_contact: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  project_location: string | null;
  issue_date: string | null;
  valid_until: string | null;
  tax_rate: number;
  /** Optional overall markup applied to the subtotal (before tax), as a fraction. */
  markup_rate: number;
  terms: string | null;
  prepared_by: string | null;
  /** Internal-only notes — never shown on the customer PDF. */
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 'pricing' rows are an internal cost worksheet — never shown on the customer
 * PDF. 'display' rows are the customer-facing lines printed on the quote, each
 * with a description and a total price. 'alternate' rows are customer-facing
 * lines belonging to a named pricing option (see `option_group`): each option is
 * totalled on its own and never summed into the base Total.
 */
export type QuoteItemKind = 'pricing' | 'display' | 'alternate';

/** Cost categories selectable on internal pricing-worksheet rows. */
export const COST_TYPES = [
  'Subcontractor',
  'Material',
  'Equipment Rentals',
  'Travel',
  'Project Management',
] as const;

export interface QuoteLineItem {
  id: number;
  quote_id: number;
  position: number;
  kind: QuoteItemKind;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  amount: number | null;
  /** Per-line markup applied to this line's amount, as a fraction (0.15 = 15%). */
  markup_rate: number;
  /** Cost category for 'pricing' rows (see COST_TYPES); NULL for display rows. */
  cost_type: string | null;
  /**
   * Name of the pricing option this line belongs to, for 'alternate' rows; NULL
   * on base and worksheet rows. An 'alternate' row with a NULL option_group is a
   * legacy single-line option and stands alone as its own option.
   */
  option_group: string | null;
  created_at: string;
}

export type QuoteWithItems = Quote & { line_items: QuoteLineItem[] };

/** A single line-item row as submitted from the quote builder. */
export interface LineItemInput {
  kind: QuoteItemKind;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  amount: number | null;
  /** Per-line markup applied to this line's amount, as a fraction (0.15 = 15%). */
  markup_rate: number;
  /** Cost category for 'pricing' rows (see COST_TYPES); null for display rows. */
  cost_type: string | null;
  /** Pricing option this line belongs to ('alternate' rows only); null otherwise. */
  option_group: string | null;
}

/** Full payload submitted when creating/updating a quote document. */
export interface QuoteDocInput {
  quote_number: string | null;
  customer: string;
  customer_contact: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  project_name: string | null;
  project_location: string | null;
  category: string | null;
  issue_date: string | null;
  valid_until: string | null;
  tax_rate: number;
  markup_rate: number;
  terms: string | null;
  notes: string | null;
  prepared_by: string | null;
  internal_notes: string | null;
  items: LineItemInput[];
}

/* ------------------------------------------------------------- Catalogs */

/** A reusable customer record that feeds the New Quote customer picker. */
export interface Customer {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A named person at a customer, with their own email + phone. */
export interface CustomerContact {
  id: number;
  customer_id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
}

export type CustomerWithContacts = Customer & { contacts: CustomerContact[] };

/** A unit of measure (ea, sf, hr, …) shared by the worksheet and price book. */
export interface Unit {
  id: number;
  label: string;
  position: number;
  created_at: string;
}

/** A quote/work category (Flooring, Painting, …), addable from the quote builder. */
export interface Category {
  id: number;
  name: string;
  position: number;
  created_at: string;
}

/** A price-book entry: a line item with a default unit and unit price. */
export interface PricingItem {
  id: number;
  description: string;
  unit: string | null;
  unit_price: number;
  category: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: number;
  quote_id: number | null;
  quote_number: string | null;
  customer: string;
  name: string;
  category: string | null;
  value: number;
  status: ProjectStatus;
  progress: number;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  due_date: string | null;
  invoice_numbers: string | null;
  invoice_notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One invoice raised against a project. `billed` means it has gone out to the
 * customer; `paid` means the money has come in. They're tracked separately —
 * an invoice can be billed and unpaid, and marking it paid implies it was
 * billed, so the UI keeps both flags in step.
 */
export interface ProjectInvoice {
  id: number;
  project_id: number;
  invoice_number: string | null;
  amount: number;
  billed: boolean;
  paid: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  id: number;
  project_id: number;
  filename: string;
  mime: string | null;
  size: number;
  uploaded_by: number | null;
  uploader_name: string | null;
  created_at: string;
  data?: string;
}

/** Supporting documentation attached to a quote — internal reference only. */
export interface QuoteFile {
  id: number;
  quote_id: number;
  filename: string;
  mime: string | null;
  size: number;
  uploaded_by: number | null;
  uploader_name: string | null;
  created_at: string;
  data?: string;
}

export interface Note {
  id: number;
  project_id: number;
  user_id: number | null;
  author_name: string;
  body: string;
  created_at: string;
}

export interface TimeEntry {
  id: number;
  project_id: number | null;
  user_id: number;
  clock_in: string;
  clock_out: string | null;
  note: string | null;
  paid: boolean;
  paid_at: string | null;
  paid_by: number | null;
  created_at: string;
}

export interface TimeBreak {
  id: number;
  time_entry_id: number;
  break_start: string;
  break_end: string | null;
  created_at: string;
}

/* ----------------------------------------------------------- Scheduling */

/** A subcontractor the company schedules work with. */
export interface Subcontractor {
  id: number;
  name: string;
  /** Framing, Drywall, Electrical, … */
  trade: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = 'not_started' | 'in_progress' | 'complete';

/**
 * How a phase hangs off the one before it.
 *   finish_to_start — starts after the predecessor FINISHES (+ lag)
 *   start_to_start  — starts a number of working days after the predecessor
 *                     STARTS, so the two phases run alongside each other
 */
export type DependsType = 'finish_to_start' | 'start_to_start';

/**
 * One phase of scheduled work on a job. `start_date` is the EARLIEST start,
 * not necessarily the real one: a phase that follows another starts when its
 * predecessor finishes — or, for a start-to-start link, a set number of days
 * after that predecessor begins — if that's later. Real dates are derived by
 * computeSchedule() in ./schedule-math, never stored.
 */
export interface ScheduleTask {
  id: number;
  project_id: number;
  name: string;
  start_date: string;
  /** Length in working days (weekends and holidays don't count). */
  duration_days: number;
  /** Predecessor phase, or null when this phase stands on its own. */
  depends_on_id: number | null;
  /** Whether the link hangs off the predecessor's finish or its start. */
  depends_type: DependsType;
  /** Working days to wait after the predecessor's finish (or start). */
  lag_days: number;
  status: TaskStatus;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * A person or sub attached to a phase. They work every working day of the
 * phase's window unless `work_days` narrows it to particular weekdays.
 */
export interface ScheduleAssignee {
  id: number;
  kind: 'user' | 'sub';
  /** users.id or subcontractors.id, depending on `kind`. */
  ref_id: number;
  name: string;
  /** Trade for subs; role for employees. */
  detail: string | null;
  /**
   * 7-bit day-of-week mask (bit 0 = Sunday … bit 6 = Saturday), or null for
   * every working day in the window. See DAY_MASK helpers in ./schedule-math.
   */
  work_days: number | null;
}

/** A phase with its job context and assignees, as the schedule views need it. */
export type ScheduleTaskRow = ScheduleTask & {
  project_name: string;
  customer: string;
  location: string | null;
  project_status: ProjectStatus;
  project_due_date: string | null;
  assignees: ScheduleAssignee[];
};

/**
 * A job whose schedule has gone out to the crew. Once a job has one of these,
 * changes to its phases have to carry a reason (see ScheduleChange).
 */
export interface SchedulePublication {
  id: number;
  project_id: number;
  /** 1 for the first publish, then up. Shown as "Published v2". */
  version: number;
  note: string | null;
  published_by: number | null;
  published_at: string;
  /** Joined for display; null when the publisher's account is gone. */
  published_by_name?: string | null;
}

/** One logged change to a published schedule: what moved, and why. */
export interface ScheduleChange {
  id: number;
  project_id: number;
  task_id: number | null;
  /** Copied at write time so history survives the phase being deleted. */
  task_name: string | null;
  kind: 'added' | 'updated' | 'deleted';
  /** Auto-generated, e.g. "Start Mar 3 → Mar 5; duration 5 → 7 days". */
  summary: string;
  /** Typed by whoever made the change. */
  reason: string;
  /** The published version the change came after. */
  version: number | null;
  changed_by: number | null;
  created_at: string;
  changed_by_name?: string | null;
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  complete: 'Complete',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  open: 'Open',
  sold: 'Sold',
  lost: 'Lost',
};
