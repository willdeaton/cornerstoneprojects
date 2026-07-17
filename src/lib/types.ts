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
  terms: string | null;
  prepared_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteLineItem {
  id: number;
  quote_id: number;
  position: number;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  created_at: string;
}

export type QuoteWithItems = Quote & { line_items: QuoteLineItem[] };

/** A single line-item row as submitted from the quote builder. */
export interface LineItemInput {
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
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
  terms: string | null;
  notes: string | null;
  prepared_by: string | null;
  items: LineItemInput[];
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
