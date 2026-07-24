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
 * full-price options (name + price) the customer picks between — they are shown
 * on the quote but never summed into the base Total.
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
