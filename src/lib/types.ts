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
  /**
   * Unique three-letter customer code (uppercase) used to prefix auto-generated
   * quote numbers — `XXXMMDDYY`. Null on customers saved before codes existed.
   */
  abbreviation: string | null;
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
  /**
   * The full street address crews drive to. `location` stays the short
   * "City, ST" label used on quotes and lists; this is the mappable one the
   * schedule shows the crew.
   */
  site_address: string | null;
  start_date: string | null;
  end_date: string | null;
  due_date: string | null;
  /**
   * A finish date that cannot move — a contractual or customer commitment.
   * `due_date` is the target; this is the promise, and the schedule warns
   * harder when derived work runs past it.
   */
  hard_finish_date: string | null;
  /**
   * The job is parked waiting on somebody else — the GC, the owner, another
   * trade. Still live work with live dates: what the flag says is that nothing
   * is waiting on us, so a job nobody is touching stops looking like a job
   * nobody has noticed.
   */
  on_hold: boolean;
  /** What the hold is waiting on. Required to place one, cleared on release. */
  on_hold_reason: string | null;
  /** When it was parked, so a hold that has sat for a month reads as one. */
  on_hold_since: string | null;
  invoice_numbers: string | null;
  invoice_notes: string | null;
  /**
   * When the job was marked complete — stamped automatically by the status
   * change, not typed. `end_date` is the date somebody entered for the work;
   * this is when the job actually arrived on the billing desk, and it's what
   * the billing queue ages against. Cleared if the job is reopened.
   */
  completed_at: string | null;
  /**
   * Billing deliberately parked — a dispute, retainage, a customer waiting on
   * paperwork. A held job keeps its place on the billing desk but stops being
   * counted late.
   */
  billing_hold: boolean;
  /** Why billing is on hold; only meaningful while `billing_hold` is true. */
  billing_hold_reason: string | null;
  /**
   * When somebody signed the job off the billing desk. A close-out is a human
   * act, not something the invoices imply: a fully paid job still wants a
   * final look, and a no-charge job is closed with nothing raised at all.
   */
  billing_closed_at: string | null;
  billing_closed_by: number | null;
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
  /** The customer's purchase order this invoice bills against. */
  po_number: string | null;
  amount: number;
  billed: boolean;
  /**
   * The day the invoice actually went out (YYYY-MM-DD), when it is known.
   * `billed` is still the flag the pipeline reads — this is the paperwork
   * answer to "when did we send it", kept in step with the flag: a date
   * implies sent, and clearing sent clears the date. NULL on an invoice that
   * went out before the date was recorded, which is honest rather than guessed.
   */
  sent_on: string | null;
  paid: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * One move of a job's contract value, and why.
 *
 * `projects.value` stays the live contract value every reader reads — this is
 * its history, appended to and never edited. The reason is required because a
 * value that changed with nothing said about it is the thing this table exists
 * to stop; `co_number` is optional because the money is often agreed before
 * the paperwork catches up.
 */
export interface ProjectValueChange {
  id: number;
  project_id: number;
  old_value: number;
  new_value: number;
  co_number: string | null;
  reason: string;
  changed_by: number | null;
  created_at: string;
  /** Joined for display. Null once the person who typed it is deleted. */
  changed_by_name: string | null;
}

/**
 * An invoice as the billing card reads it: the row plus what is known about
 * its attached PDF, never the bytes. Both fields are NULL when nothing has
 * been attached.
 */
export interface ProjectInvoiceWithFile extends ProjectInvoice {
  pdf_filename: string | null;
  pdf_size: number | null;
}

/** The invoice PDF itself — one per invoice, bytes and all. */
export interface InvoiceFile {
  invoice_id: number;
  /** The invoice's project, carried along so the route can authorize on it. */
  project_id: number;
  filename: string;
  mime: string | null;
  size: number;
  data: string;
  uploaded_by: number | null;
  uploader_name: string | null;
  created_at: string;
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

/* ------------------------------------------------------------- Job receipts */

/**
 * The cost buckets a job's receipts are totalled by.
 *
 * Mirrored by the CHECK constraint on project_receipts.category — adding one
 * here means adding it there too, which is why that constraint is declared as
 * DROP/ADD in migrateReceipts rather than inline.
 */
export const RECEIPT_CATEGORIES = [
  'Material',
  'Fuel',
  'Tools',
  'Subcontractor',
  'Other',
] as const;
export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];

/**
 * Whether the money on a receipt was typed or read off the photo.
 *
 * Everything is 'manual' today. The other two exist so that reading receipts
 * automatically can be added later without a migration, and so a corrected
 * number is distinguishable from one nobody has checked.
 */
export type ReceiptEntrySource = 'manual' | 'extracted' | 'extracted_edited';

/**
 * One receipt against a job.
 *
 * The image_* fields are metadata LEFT JOINed from receipt_images — never the
 * blob itself, which only the image route reads.
 */
export interface ProjectReceipt {
  id: number;
  project_id: number;
  vendor: string | null;
  /** 'YYYY-MM-DD' — a DATE, so it is the day on the paper in every timezone. */
  purchase_date: string | null;
  category: ReceiptCategory;
  subtotal: number;
  tax: number;
  total: number;
  note: string | null;
  entry_source: ReceiptEntrySource;
  uploaded_by: number | null;
  uploader_name: string | null;
  created_at: string;
  updated_at: string;
  image_filename: string | null;
  image_mime: string | null;
  image_size: number | null;
  /** Whether a thumbnail exists, so the table knows to ask for the small one. */
  has_thumb: boolean;
}

/** A line off a receipt. `amount` null means quantity x unit_price. */
export interface ReceiptLineItem {
  id: number;
  receipt_id: number;
  position: number;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number | null;
}

/** A receipt with its lines, as the Receipts tab renders it. */
export interface ReceiptWithItems extends ProjectReceipt {
  items: ReceiptLineItem[];
}

/** The photo itself. Read by the image route and nothing else. */
export interface ReceiptImage {
  receipt_id: number;
  filename: string;
  mime: string | null;
  size: number;
  data: string;
  thumb: string | null;
}

export interface ReceiptLineItemInput {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number | null;
}

/** Everything a create or update writes, the photo aside. */
export interface ReceiptInput {
  project_id: number;
  vendor: string | null;
  purchase_date: string | null;
  category: ReceiptCategory;
  subtotal: number;
  tax: number;
  total: number;
  note: string | null;
  entry_source: ReceiptEntrySource;
  items: ReceiptLineItemInput[];
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
  /**
   * How many of OUR people this phase needs on site. Set on the timeline
   * alongside the duration — the two together are the phase's crew budget
   * (crew_size x working days), which the crew week then fills with actual
   * people. Zero on a phase a subcontractor covers outright.
   */
  crew_size: number;
  /**
   * The subcontractor doing this phase, or null when it's our own crew's work.
   * Chosen on the timeline rather than booked day by day: a sub is contracted
   * for the phase, and their days on site follow its dates automatically.
   */
  subcontractor_id: number | null;
  status: TaskStatus;
  /**
   * What time the crew starts each day of this phase, as 'HH:MM' (24-hour),
   * or null when no time is set and they work their normal hours. Individual
   * days can override it — see `day_times` on ScheduleTaskRow. Set from the
   * crew week, where the days are in front of you, not from the timeline.
   */
  start_time: string | null;
  /**
   * How long the crew is on this job each day, in hours — the other half of
   * the shift `start_time` opens. Null means ALL DAY, which is what a job
   * books for unless somebody says otherwise: most work takes the day it
   * takes, and only a job deliberately split with another needs a length.
   *
   * A phase with a start time AND hours is a bounded shift (8:00 for 4 hours
   * ends at noon), which is what lets one person be booked at two places on
   * one day — mornings here, afternoons there — without the two reading as a
   * double-booking. Individual days can override it, same as the start time.
   */
  hours: number | null;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * The shift set on one specific day of a phase, overriding the phase's own
 * `start_time` and `hours`. A row is the whole day's shift, so a `start_time`
 * of null clears the time for that day and `hours` of null makes it all day.
 */
export interface TaskDayTime {
  day: string;
  start_time: string | null;
  /** Hours worked that day; null is all day, whatever the phase says. */
  hours: number | null;
}

/**
 * One person booked on one phase for one day — the unit crew is scheduled in.
 *
 * A week of work for one employee is several of these, and a phase's staffing
 * is all of them across its window. Booking a day at a time is what lets a
 * five-day phase needing two people be covered by four people on Monday and
 * one on Friday, which is how the week usually actually falls.
 */
export interface CrewDay {
  id: number;
  /** The day worked, 'YYYY-MM-DD'. */
  day: string;
  kind: 'user' | 'sub';
  /** users.id or subcontractors.id, depending on `kind`. */
  ref_id: number;
  name: string;
  /** Trade for subs; role for employees. */
  detail: string | null;
}

/** A phase with its job context and day-by-day crew, as the views need it. */
export type ScheduleTaskRow = ScheduleTask & {
  project_name: string;
  customer: string;
  /** The job's quote number — the proposal the work was sold on. */
  quote_number: string | null;
  /** The job's category — the service being delivered. */
  project_category: string | null;
  /** The job's contract value, so a card can say what the work is worth. */
  project_value: number;
  location: string | null;
  /** The job's site address, so the crew views never need a second query. */
  site_address: string | null;
  project_status: ProjectStatus;
  project_due_date: string | null;
  /** The job's immovable finish date, when it has one. */
  project_hard_finish_date: string | null;
  /** The job is parked waiting on somebody else — see `Project.on_hold`. */
  project_on_hold: boolean;
  /** What that hold is waiting on, for the views that can show it. */
  project_on_hold_reason: string | null;
  /** When the job was parked. */
  project_on_hold_since: string | null;
  /** The subcontractor's name, when the phase is theirs. */
  subcontractor_name: string | null;
  /** Who is booked on which day, ascending by day then name. */
  crew_days: CrewDay[];
  /** Per-day start-time overrides for this phase, ascending by day. */
  day_times: TaskDayTime[];
};

/**
 * One person in the warehouse for one day — the unit the standing warehouse
 * card is booked in.
 *
 * The mirror of `CrewDay`, deliberately thinner. Warehouse work has no
 * customer, no phase and no crew budget: it is always there, it never fills
 * up, and it is only ever our own people, so there is no `kind` to switch on
 * and no window to check a day against. `name` and `detail` are joined for
 * display, exactly as `CrewDay` carries them.
 */
export interface WarehouseDay {
  id: number;
  /** The day worked, 'YYYY-MM-DD'. */
  day: string;
  user_id: number;
  name: string;
  /** The person's role, for the crew week's row label. */
  detail: string | null;
}

/**
 * A message written for the people working a job — gate codes, parking, who to
 * ask for on site. Shown on every assignee's own schedule, unlike the internal
 * job notes in `Note`.
 */
export interface CrewNote {
  id: number;
  project_id: number;
  body: string;
  /** Pinned notes sort to the top however old they are. */
  pinned: boolean;
  author_id: number | null;
  author_name: string;
  created_at: string;
  updated_at: string;
}

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

/**
 * One logged change to a job's schedule: what moved, and why. Logged whether or
 * not the schedule has been published — anything that moves dates carries a
 * reason from the first plan onwards.
 */
export interface ScheduleChange {
  id: number;
  project_id: number;
  task_id: number | null;
  /** Copied at write time so history survives the phase being deleted. */
  task_name: string | null;
  /** 'job' is a change to the job itself (its hard finish date), not a phase. */
  kind: 'added' | 'updated' | 'deleted' | 'job';
  /** Auto-generated, e.g. "Start Mar 3 → Mar 5; duration 5 → 7 days". */
  summary: string;
  /** Typed by whoever made the change. */
  reason: string;
  /** The published version the change came after; null before the first publish. */
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
