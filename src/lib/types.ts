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
  project_id: number;
  user_id: number;
  clock_in: string;
  clock_out: string | null;
  note: string | null;
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
