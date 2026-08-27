import 'server-only';
import type { PoolClient } from 'pg';
import { getDb } from './db';
import type {
  Quote,
  QuoteLineItem,
  QuoteWithItems,
  QuoteDocInput,
  LineItemInput,
  Project,
  Note,
  TimeEntry,
  ProjectFile,
  ProjectReceipt,
  ReceiptWithItems,
  ReceiptLineItem,
  ReceiptImage,
  ReceiptInput,
  ProjectInvoice,
  ProjectInvoiceWithFile,
  ProjectValueChange,
  ValueChangeSource,
  InvoiceFile,
  QuoteFile,
  QuoteStatus,
  ProjectStatus,
  Customer,
  CustomerContact,
  CustomerWithContacts,
  PricingItem,
  Unit,
  Category,
  Subcontractor,
  TaskStatus,
  DependsType,
} from './types';
import type {
  BackupData,
  BackupQuote,
  BackupProjectFile,
  BackupTimeEntry,
  BackupSchedulePhase,
} from './backup-types';
import { billingStage, contractLocked, tallyInvoices, type InvoiceTally } from './billing';
import { hoursBetween } from './format';
import { computeSchedule, shiftLabel, timeLabel, workingDaySpan } from './schedule-math';
import { isValidSynopsis, SYNOPSIS_ERROR } from './synopsis';
import type { MathLine } from './quote-math';
import { blockTotals, groupQuoteLines } from './quote-math';

// Re-exported so server callers keep a single import site for the quote math.
export { lineAmount, groupQuoteLines } from './quote-math';

/* -------------------------------------------------------------- Query helpers */

// Exported so sibling data modules (./schedule-data) share one set of helpers.
export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const db = await getDb();
  const res = await db.query(text, params);
  return res.rows as T[];
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await q<T>(text, params);
  return rows[0];
}

/* ----------------------------------------------------------------- Quotes */

export async function listQuotes(status?: QuoteStatus): Promise<Quote[]> {
  if (status) {
    return q<Quote>('SELECT * FROM quotes WHERE status = $1 ORDER BY bid_value DESC', [status]);
  }
  return q<Quote>('SELECT * FROM quotes ORDER BY bid_value DESC');
}

export async function getQuote(id: number): Promise<Quote | undefined> {
  return one<Quote>('SELECT * FROM quotes WHERE id = $1', [id]);
}

/*
 * A quote's header and its line items are only ever written together, by
 * `createQuoteWithItems` / `updateQuoteWithItems` below. There is deliberately
 * no header-only writer: `bid_value` is derived from the customer-facing lines,
 * so anything that set it on its own would leave the headline price disagreeing
 * with the lines behind it until the next document save quietly overwrote one
 * of them.
 */

export async function updateQuoteStatus(id: number, status: QuoteStatus): Promise<void> {
  await q('UPDATE quotes SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
}

export async function deleteQuote(id: number): Promise<void> {
  await q('DELETE FROM quotes WHERE id = $1', [id]);
}

/** Mark a quote sold and create a matching project. Returns new project id. */
export async function convertQuoteToProject(id: number): Promise<number | null> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM quotes WHERE id = $1', [id]);
    const quote = rows[0] as Quote | undefined;
    if (!quote) {
      await client.query('ROLLBACK');
      return null;
    }
    const inserted = await client.query(
      // The quote already knows where the work is, so the new job starts with an
      // address the crew can be sent to: the job's own location if the quote
      // named one, otherwise the customer's.
      //
      // `quote_synced_value` is the baseline every later revision is measured
      // from — the job leaves here reconciled with the quote it came from, so
      // the first thing that moves the quote is the first thing that shows as
      // drift.
      `INSERT INTO projects
         (quote_id, quote_number, customer, name, category, value, status, site_address,
          quote_synced_value)
       VALUES ($1,$2,$3,$4,$5,$6,'not_started',$7,$8) RETURNING id`,
      [
        id,
        quote.quote_number,
        quote.customer,
        quote.project_name ?? quote.customer,
        quote.category,
        quote.bid_value,
        quote.project_location ?? quote.customer_address ?? null,
        quote.bid_value,
      ]
    );
    const projectId = inserted.rows[0].id as number;
    await client.query("UPDATE quotes SET status = 'sold', updated_at = now() WHERE id = $1", [id]);
    await client.query('COMMIT');
    return projectId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------- Quote documents (line items) */

/**
 * Subtotal / markup / total for a quote's BASE lines — the customer-facing lines
 * that aren't part of a pricing option. 'pricing' rows are an internal worksheet
 * and 'alternate' rows belong to an option (each option is totalled on its own),
 * so neither counts here. Items with no kind are treated as base lines for
 * backward compatibility with quotes created before the kinds split.
 *
 * Markup is per line: each line's amount is grown by its own markup_rate, then
 * rounded to cents so the stored total matches the sum of the printed line
 * prices on the customer PDF. There is no tax.
 */
export function quoteTotals(
  items: MathLine[]
): { subtotal: number; markup: number; total: number } {
  return blockTotals(groupQuoteLines(items).base);
}

/**
 * The single headline number stored on the quote (`bid_value`) and used across
 * the pipeline/dashboard. Normally the base-line total; but a quote made only of
 * pricing options has no base lines, so we fall back to the highest option total
 * so the quote still shows a value instead of $0. Options with no price are
 * skipped, and a quote whose options are all blank returns 0.
 */
export function headlineBid(items: MathLine[]): number {
  const { base, groups } = groupQuoteLines(items);
  if (base.length > 0) return blockTotals(base).total;
  const totals = groups.map((g) => blockTotals(g.rows).total).filter((t) => t > 0);
  return totals.length ? Math.max(...totals) : 0;
}

export async function getQuoteWithItems(id: number): Promise<QuoteWithItems | undefined> {
  const quote = await getQuote(id);
  if (!quote) return undefined;
  const line_items = await q<QuoteLineItem>(
    'SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY position, id',
    [id]
  );
  return { ...quote, line_items };
}

/**
 * Write a quote's line items, returning how many actually landed. The count is
 * reported back to the builder so a row dropped on the way in can be shown to
 * the user instead of passing for a clean save.
 */
async function replaceItems(
  client: PoolClient,
  quoteId: number,
  items: LineItemInput[]
): Promise<number> {
  let saved = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const kind =
      it.kind === 'pricing' ? 'pricing' : it.kind === 'alternate' ? 'alternate' : 'display';
    // Blank rows are unfinished input and get dropped — except a priced option
    // line, which is kept so a real price is never lost to a missing label.
    if (!it.description?.trim() && !(kind === 'alternate' && it.amount != null)) continue;
    await client.query(
      `INSERT INTO quote_line_items (quote_id, position, kind, description, quantity, unit, unit_price, amount, markup_rate, cost_type, option_group)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        quoteId,
        i,
        kind,
        it.description?.trim() ?? '',
        it.quantity || 0,
        it.unit?.trim() || null,
        it.unit_price || 0,
        it.amount == null ? null : it.amount,
        it.markup_rate || 0,
        it.cost_type?.trim() || null,
        // Only option lines carry a group name, whatever the caller sent.
        kind === 'alternate' ? it.option_group?.trim() || null : null,
      ]
    );
    saved++;
  }
  return saved;
}

// Header columns written by both create and update, in a fixed order so the
// two INSERT/UPDATE statements stay in sync. date_received mirrors issue_date
// so quote documents flow into the dashboard's weekly buckets.
function headerValues(input: QuoteDocInput, total: number): unknown[] {
  return [
    input.quote_number ?? null,
    input.customer,
    input.project_name ?? null,
    input.category ?? null,
    total,
    input.issue_date ?? null, // date_received
    input.customer_contact ?? null,
    input.customer_email ?? null,
    input.customer_phone ?? null,
    input.customer_address ?? null,
    input.project_location ?? null,
    input.issue_date ?? null,
    input.valid_until ?? null,
    input.tax_rate ?? 0,
    input.markup_rate ?? 0,
    input.terms ?? null,
    input.notes ?? null,
    input.prepared_by ?? null,
    input.internal_notes ?? null,
  ];
}

export async function createQuoteWithItems(
  input: QuoteDocInput,
  opts?: { source?: string; week_of?: string | null }
): Promise<{ id: number; saved: number }> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const total = headlineBid(input.items);
    const res = await client.query(
      `INSERT INTO quotes
         (quote_number, customer, project_name, category, bid_value, date_received,
          customer_contact, customer_email, customer_phone, customer_address,
          project_location, issue_date, valid_until, tax_rate, markup_rate, terms, notes,
          prepared_by, internal_notes, source, week_of)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id`,
      [...headerValues(input, total), opts?.source ?? 'manual', opts?.week_of ?? null]
    );
    const id = res.rows[0].id as number;
    const saved = await replaceItems(client, id, input.items);
    await client.query('COMMIT');
    return { id, saved };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateQuoteWithItems(
  id: number,
  input: QuoteDocInput
): Promise<{ saved: number }> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // bid_value comes from the CUSTOMER-FACING lines, so what matters is
    // whether this save carried any — not whether it carried items at all. A
    // save of nothing but internal worksheet rows would otherwise recompute the
    // headline as $0 and wipe the value off the pipeline and the dashboard.
    //
    // With no customer lines in hand there are two cases, and only one of them
    // is worth zero: a quote that HAD them and has had them all removed really
    // is empty now, while a quote that never had any (imported / quick-added,
    // worksheet-only) must keep the value already stored on it.
    const { base, groups } = groupQuoteLines(input.items);
    let total: number;
    if (base.length > 0 || groups.length > 0) {
      total = headlineBid(input.items);
    } else {
      const existing = await client.query(
        `SELECT q.bid_value,
                EXISTS (
                  SELECT 1 FROM quote_line_items
                   WHERE quote_id = q.id
                     AND (kind IS NULL OR kind IN ('display', 'alternate'))
                ) AS had_lines
           FROM quotes q WHERE q.id = $1`,
        [id]
      );
      total = existing.rows[0]?.had_lines
        ? 0
        : ((existing.rows[0]?.bid_value as number | undefined) ?? 0);
    }
    await client.query(
      `UPDATE quotes SET
         quote_number=$1, customer=$2, project_name=$3, category=$4, bid_value=$5,
         date_received=$6, customer_contact=$7, customer_email=$8, customer_phone=$9,
         customer_address=$10, project_location=$11, issue_date=$12, valid_until=$13,
         tax_rate=$14, markup_rate=$15, terms=$16, notes=$17, prepared_by=$18,
         internal_notes=$19, updated_at=now()
       WHERE id=$20`,
      [...headerValues(input, total), id]
    );
    await client.query('DELETE FROM quote_line_items WHERE quote_id = $1', [id]);
    const saved = await replaceItems(client, id, input.items);
    await client.query('COMMIT');
    return { saved };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ---------------------------------------------------- Quote supporting files */

export async function listQuoteFiles(quoteId: number): Promise<QuoteFile[]> {
  // Deliberately omit `data` (the base64 blob) from listings.
  return q<QuoteFile>(
    `SELECT id, quote_id, filename, mime, size, uploaded_by, uploader_name, created_at
     FROM quote_files WHERE quote_id = $1 ORDER BY created_at DESC`,
    [quoteId]
  );
}

export async function getQuoteFile(
  id: number
): Promise<(QuoteFile & { data: string }) | undefined> {
  return one<QuoteFile & { data: string }>('SELECT * FROM quote_files WHERE id = $1', [id]);
}

export async function addQuoteFile(f: {
  quote_id: number;
  filename: string;
  mime: string | null;
  size: number;
  data: string;
  uploaded_by: number | null;
  uploader_name: string | null;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO quote_files (quote_id, filename, mime, size, data, uploaded_by, uploader_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [f.quote_id, f.filename, f.mime, f.size, f.data, f.uploaded_by, f.uploader_name]
  );
  return row!.id;
}

export async function deleteQuoteFile(id: number): Promise<void> {
  await q('DELETE FROM quote_files WHERE id = $1', [id]);
}

/* --------------------------------------------------------------- Projects */

export async function listProjects(status?: ProjectStatus): Promise<Project[]> {
  if (status) {
    return q<Project>('SELECT * FROM projects WHERE status = $1 ORDER BY value DESC', [status]);
  }
  return q<Project>('SELECT * FROM projects ORDER BY value DESC');
}

export async function getProject(id: number): Promise<Project | undefined> {
  return one<Project>('SELECT * FROM projects WHERE id = $1', [id]);
}

export async function createProject(p: {
  customer: string;
  name: string;
  quote_number?: string | null;
  category?: string | null;
  value: number;
  status?: ProjectStatus;
  location?: string | null;
  /** Full site address the crew drives to. */
  site_address?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  due_date?: string | null;
  /** A finish date that can't move, as opposed to the due-date target. */
  hard_finish_date?: string | null;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO projects
       (customer, name, quote_number, category, value, status, location, site_address,
        start_date, end_date, due_date, hard_finish_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      p.customer,
      p.name,
      p.quote_number ?? null,
      p.category ?? null,
      p.value,
      p.status ?? 'not_started',
      p.location ?? null,
      p.site_address ?? null,
      p.start_date ?? null,
      p.end_date ?? null,
      p.due_date ?? null,
      p.hard_finish_date ?? null,
    ]
  );
  return row!.id;
}

export async function updateProject(
  id: number,
  fields: Partial<
    Pick<
      Project,
      | 'status'
      | 'progress'
      | 'due_date'
      | 'hard_finish_date'
      | 'start_date'
      | 'end_date'
      | 'location'
      | 'site_address'
      | 'name'
      | 'category'
      | 'quote_number'
      | 'invoice_numbers'
      | 'invoice_notes'
    >
  >
): Promise<void> {
  // The contract value is not settable here, and the guard is at runtime as
  // well as in the type above: the SET clause is built from these keys, so a
  // caller spreading an object it did not fully control would otherwise write
  // the one field that has to go through recordProjectValueChange — with a
  // reason, and a history row. One write path, enforced rather than intended.
  const entries = Object.entries(fields).filter(
    ([k, v]) => v !== undefined && k !== 'value'
  );
  if (entries.length === 0) return;
  const set = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  const values = entries.map(([, v]) => v);
  // A job's completion stamp follows its status wherever the status is set, so
  // it lives here rather than in one caller: completing a job stamps it (and
  // re-completing an already-complete job keeps the original date), reopening
  // one clears it. It's what the billing queue ages against, so it has to be
  // the moment the job arrived on the desk and nothing looser.
  const stamp = fields.status
    ? `, completed_at = ${
        fields.status === 'completed' ? 'COALESCE(completed_at, now())' : 'NULL'
      }`
    : '';
  await q(
    `UPDATE projects SET ${set}${stamp}, updated_at = now() WHERE id = $${entries.length + 1}`,
    [...values, id]
  );
}

/**
 * How much sits behind each tab of a job's page, in one round trip.
 *
 * The job page is a set of tabs over one project, and each tab loads only its
 * own rows. The overview still wants to say what's waiting on the others
 * ("3 invoices", "12 phases"), and fetching six lists just to call `.length`
 * on them would undo the point of splitting the page up — so the counts come
 * back as scalars from a single query instead.
 */
export interface ProjectHubCounts {
  phases: number;
  invoices: number;
  notes: number;
  crewNotes: number;
  files: number;
  timeEntries: number;
  receipts: number;
  /** Receipt spend on the job, so the overview can show it without loading rows. */
  receiptTotal: number;
}

export async function getProjectHubCounts(projectId: number): Promise<ProjectHubCounts> {
  const row = await one<{
    phases: string;
    invoices: string;
    notes: string;
    crew_notes: string;
    files: string;
    time_entries: string;
    receipts: string;
    receipt_total: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM schedule_tasks  WHERE project_id = $1) AS phases,
       (SELECT COUNT(*) FROM project_invoices WHERE project_id = $1) AS invoices,
       (SELECT COUNT(*) FROM notes           WHERE project_id = $1) AS notes,
       (SELECT COUNT(*) FROM crew_notes      WHERE project_id = $1) AS crew_notes,
       (SELECT COUNT(*) FROM project_files   WHERE project_id = $1) AS files,
       (SELECT COUNT(*) FROM time_entries    WHERE project_id = $1) AS time_entries,
       (SELECT COUNT(*) FROM project_receipts WHERE project_id = $1) AS receipts,
       -- Summed in SQL rather than by loading the rows: the overview wants one
       -- number, and this whole function exists so it doesn't pay for a listing.
       (SELECT COALESCE(SUM(total), 0) FROM project_receipts
         WHERE project_id = $1) AS receipt_total`,
    [projectId]
  );
  // COUNT(*) arrives as a string from pg (bigint), so every one is parsed.
  return {
    phases: Number(row?.phases ?? 0),
    invoices: Number(row?.invoices ?? 0),
    notes: Number(row?.notes ?? 0),
    crewNotes: Number(row?.crew_notes ?? 0),
    files: Number(row?.files ?? 0),
    timeEntries: Number(row?.time_entries ?? 0),
    receipts: Number(row?.receipts ?? 0),
    receiptTotal: Number(row?.receipt_total ?? 0),
  };
}

/**
 * Park a job while somebody else finishes their part, or put it back to work.
 *
 * A hold changes nothing about the job's own status or dates — the work is
 * still sold, still planned, still where it was. It records that nothing is
 * waiting on us, and what it IS waiting on, so a job standing still stops
 * looking like a job that has been forgotten. Releasing clears the reason and
 * the timestamp with it, so a job that gets parked twice dates from the second
 * time rather than the first.
 */
export async function setProjectOnHold(
  id: number,
  hold: boolean,
  reason: string | null
): Promise<void> {
  await q(
    `UPDATE projects
        SET on_hold = $1,
            on_hold_reason = $2,
            on_hold_since = CASE WHEN $1 THEN COALESCE(on_hold_since, now()) ELSE NULL END,
            updated_at = now()
      WHERE id = $3`,
    [hold, hold ? reason : null, id]
  );
}

/* -------------------------------------------------------- Billing workflow */

/**
 * Record (or clear) the customer's PO for a job.
 *
 * Deliberately its own writer rather than three more keys on `updateProject`:
 * the PO is billing paperwork, written only from behind the billing gate, and
 * the three fields move together — clearing the number clears the figure and
 * the date with it, because an amount authorized by no PO is not a fact about
 * anything.
 */
export async function setProjectPurchaseOrder(
  id: number,
  po: { po_number: string | null; po_amount: number | null; po_date: string | null }
): Promise<void> {
  const cleared = !po.po_number;
  await q(
    `UPDATE projects
        SET po_number = $1,
            po_amount = $2,
            po_date   = $3,
            updated_at = now()
      WHERE id = $4`,
    [po.po_number, cleared ? null : po.po_amount, cleared ? null : po.po_date, id]
  );
}

/**
 * Park or release a job's billing. A hold carries a reason — the point of it
 * is that the next person to look at the queue knows why nobody is chasing
 * this one — and releasing clears the reason with it.
 */
export async function setProjectBillingHold(
  id: number,
  hold: boolean,
  reason: string | null
): Promise<void> {
  await q(
    `UPDATE projects
        SET billing_hold = $1, billing_hold_reason = $2, updated_at = now()
      WHERE id = $3`,
    [hold, hold ? reason : null, id]
  );
}

/**
 * Sign a job off the billing desk, or put it back on. Closing records who did
 * it and when; reopening clears both, so a reopened job re-derives its stage
 * from its invoices exactly as if it had never been closed.
 */
export async function setProjectBillingClosed(
  id: number,
  closed: boolean,
  userId: number | null
): Promise<void> {
  await q(
    `UPDATE projects
        SET billing_closed_at = CASE WHEN $1::boolean THEN now() ELSE NULL END,
            -- $2 is cast explicitly: inside a CASE against NULL there is
            -- nothing for Postgres to infer a parameter's type from, so it
            -- assumes text and the assignment to an integer column is rejected.
            billing_closed_by = CASE WHEN $1::boolean THEN $2::int ELSE NULL END,
            updated_at = now()
      WHERE id = $3`,
    [closed, userId, id]
  );
}

/**
 * Mark a job's billing done without asking anybody to type an invoice.
 *
 * This is the short path for work that is simply billed and collected outside
 * this app: no invoice number, no PO, no PDF. Every invoice already on the job
 * is marked sent — and paid too when asked — and a job with nothing raised
 * against it gets one row for its contract value, so the derived stage moves
 * exactly as it would have if the paperwork had been entered by hand. The row
 * is an ordinary invoice: the ledger on the billing desk is where it gets a
 * number later, an amount corrected, or the whole thing undone.
 *
 * `sent_on` is filled in with today only where it is missing, so a date already
 * recorded for an invoice is never overwritten by a bulk mark. Nothing is ever
 * un-marked here: `paid = paid OR $2` means marking sent leaves the paid rows
 * paid.
 *
 * Returns the number of invoices touched, counting one for a row it had to
 * raise, so a caller can tell a no-op from real work.
 */
export async function markProjectBilling(projectId: number, paid: boolean): Promise<number> {
  const updated = await q<{ id: number }>(
    `UPDATE project_invoices
        SET billed  = TRUE,
            sent_on = COALESCE(sent_on, CURRENT_DATE),
            paid    = paid OR $2,
            updated_at = now()
      WHERE project_id = $1
      RETURNING id`,
    [projectId, paid]
  );
  if (updated.length > 0) return updated.length;

  // Nothing raised against the job yet, so the mark has to raise it. The
  // amount is the contract value, read in the same statement rather than
  // fetched first — the job is what says what it is worth.
  // The job's own PO comes along with it: it is the one piece of invoice
  // detail we already have, and a row raised without it would lose paperwork
  // somebody had deliberately recorded.
  const raised = await q<{ id: number }>(
    `INSERT INTO project_invoices (project_id, po_number, amount, billed, sent_on, paid, position)
     SELECT p.id, p.po_number, GREATEST(p.value, 0), TRUE, CURRENT_DATE, $2, 1
       FROM projects p
      WHERE p.id = $1
     RETURNING id`,
    [projectId, paid]
  );
  return raised.length;
}

/* ------------------------------------------- Contract value & change orders */

/** What happened to a contract-value change — or why nothing did. */
export type ValueChangeResult =
  | { status: 'ok'; change: ProjectValueChange }
  | { status: 'missing' }
  | { status: 'locked'; stage: 'paid' | 'closed' }
  | { status: 'noop'; value: number };

/**
 * Move a sold job's contract value and record why, in one transaction.
 *
 * `projects.value` is the live figure every reader already uses — the dashboard
 * total, the billing desk's variance, the job header — so it is updated in
 * place, and the row written beside it is what makes the move auditable. Both
 * happen or neither does: a value that moved with no reason attached is the
 * exact thing this exists to prevent.
 *
 * The stage guard is evaluated HERE rather than trusted from the caller,
 * against the rows as they are right now — the dialog's copy of them may be
 * minutes old. `FOR UPDATE` is what makes the logged `old_value` true: two
 * change orders landing together serialize on the lock, so the second one's
 * "was" is the first one's "now" and the history chains instead of both rows
 * quoting the same stale figure.
 */
export async function recordProjectValueChange(input: {
  project_id: number;
  /** Already parsed and rounded to cents by the caller. */
  new_value: number;
  co_number: string | null;
  reason: string;
  changed_by: number | null;
  /** Where this came from. Defaults to a hand-recorded change order. */
  source?: ValueChangeSource;
  /**
   * The quote bid value this change reconciles the job to, for a revision
   * pushed from a sold quote. Written in the SAME transaction as the value
   * move: a job whose contract went up but whose baseline didn't would offer
   * the same revision again the next time anybody looked at it.
   */
  sync_quote_value?: number | null;
}): Promise<ValueChangeResult> {
  const pool = await getDb();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<
      Pick<Project, 'value' | 'status' | 'completed_at' | 'billing_hold' | 'billing_closed_at'>
    >(
      `SELECT value, status, completed_at, billing_hold, billing_closed_at
         FROM projects WHERE id = $1 FOR UPDATE`,
      [input.project_id]
    );
    const project = locked.rows[0];
    if (!project) {
      await client.query('ROLLBACK');
      return { status: 'missing' };
    }

    const invoices = await client.query<Pick<ProjectInvoice, 'amount' | 'billed' | 'paid'>>(
      'SELECT amount, billed, paid FROM project_invoices WHERE project_id = $1',
      [input.project_id]
    );
    const stage = billingStage(project, tallyInvoices(invoices.rows));
    if (contractLocked(stage)) {
      await client.query('ROLLBACK');
      return { status: 'locked', stage };
    }

    // To the cent, and judged against the value as it actually is: a dialog
    // submitted twice, or opened on a figure somebody else has since set, must
    // not write a change of nothing.
    if (Math.round(project.value * 100) === Math.round(input.new_value * 100)) {
      await client.query('ROLLBACK');
      return { status: 'noop', value: project.value };
    }

    await client.query(
      `UPDATE projects
          SET value = $2,
              quote_synced_value = COALESCE($3, quote_synced_value),
              updated_at = now()
        WHERE id = $1`,
      [input.project_id, input.new_value, input.sync_quote_value ?? null]
    );
    const inserted = await client.query<ProjectValueChange>(
      `INSERT INTO project_value_changes
         (project_id, old_value, new_value, co_number, reason, changed_by, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *, NULL::text AS changed_by_name`,
      [
        input.project_id,
        project.value,
        input.new_value,
        input.co_number,
        input.reason,
        input.changed_by,
        input.source ?? 'manual',
      ]
    );
    await client.query('COMMIT');
    return { status: 'ok', change: inserted.rows[0]! };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * What a job was sold for and how often that has moved — one row, for views
 * that want the signal without paying for the history. `sold_at` is NULL on a
 * job that has never been changed, which is every job until somebody records
 * a change order.
 */
export async function projectValueRevision(
  projectId: number
): Promise<{ soldAt: number; changes: number } | null> {
  const row = await one<{ sold_at: number | null; changes: number }>(
    `SELECT
       (SELECT old_value FROM project_value_changes
         WHERE project_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1) AS sold_at,
       (SELECT COUNT(*)::int FROM project_value_changes WHERE project_id = $1) AS changes`,
    [projectId]
  );
  if (!row || row.sold_at == null) return null;
  return { soldAt: row.sold_at, changes: row.changes };
}

/**
 * A job's contract-value history, newest first. The name is joined rather than
 * copied — unlike a schedule change's task name, a user row is only ever
 * removed, and `changed_by` going NULL is exactly what "we no longer know who"
 * should read as.
 */
export async function listProjectValueChanges(
  projectId: number,
  limit = 50
): Promise<ProjectValueChange[]> {
  return q<ProjectValueChange>(
    `SELECT c.*, u.name AS changed_by_name
       FROM project_value_changes c
       LEFT JOIN users u ON u.id = c.changed_by
      WHERE c.project_id = $1
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $2`,
    [projectId, limit]
  );
}

/* ------------------------------------------- Post-sale quote revisions */

/**
 * A sold quote and the job it became, side by side — everything
 * `quoteSyncDiff` needs and nothing else.
 *
 * Returns `null` when there is nothing to reconcile: no such quote, a quote
 * that was never sold, or a sold quote whose project has since been deleted
 * (`projects.quote_id` goes NULL rather than cascading, so the job outliving
 * the link and the link outliving the job both land here).
 */
export async function getQuoteSyncPair(
  quoteId: number
): Promise<{ quote: Quote; project: Project } | null> {
  const quote = await getQuote(quoteId);
  if (!quote || quote.status !== 'sold') return null;
  // `ORDER BY id` rather than trusting there to be one: a quote reopened and
  // sold again before that was guarded could have left two jobs behind it, and
  // the first one is the one the work has been going on against.
  const project = await one<Project>(
    'SELECT * FROM projects WHERE quote_id = $1 ORDER BY id LIMIT 1',
    [quoteId]
  );
  return project ? { quote, project } : null;
}

/** The same pair, reached from the job — what the out-of-sync banner reads. */
export async function getProjectSyncPair(
  projectId: number
): Promise<{ quote: Quote; project: Project } | null> {
  const project = await getProject(projectId);
  if (!project?.quote_id) return null;
  const quote = await getQuote(project.quote_id);
  return quote && quote.status === 'sold' ? { quote, project } : null;
}

/**
 * Copy the agreed detail fields from a revised quote onto its job.
 *
 * Deliberately separate from the contract value: these are labels, and a job
 * whose billing has settled can still have its address corrected. Only the
 * keys the caller ticked are written, so a name somebody deliberately changed
 * on the job survives a revision that only moved the address.
 */
export async function applyQuoteSyncFields(
  projectId: number,
  fields: Partial<Pick<Project, 'name' | 'customer' | 'category' | 'quote_number' | 'site_address'>>
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const set = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  await q(
    `UPDATE projects SET ${set}, updated_at = now() WHERE id = $${entries.length + 1}`,
    [...entries.map(([, v]) => v), projectId]
  );
}

/**
 * Move the job's reconciliation baseline to the quote's current bid value
 * WITHOUT touching what the job is worth.
 *
 * This is "seen it, not taking it": a price corrected on the quote that was
 * never a change to the work, or a revision the biller has decided to answer
 * with a change order of their own. It clears the banner honestly — the job is
 * reconciled with the quote as of now — and leaves the contract value, and its
 * history, exactly as they were.
 */
export async function acknowledgeQuoteSync(projectId: number, quoteValue: number): Promise<void> {
  await q('UPDATE projects SET quote_synced_value = $2, updated_at = now() WHERE id = $1', [
    projectId,
    quoteValue,
  ]);
}

/**
 * Invoice totals for a set of jobs, in one grouped query — for lists that show
 * where a job stands on billing without wanting its individual invoices.
 * Jobs with no invoices are simply absent from the map.
 */
export async function listInvoiceTallies(
  projectIds: number[]
): Promise<Map<number, InvoiceTally>> {
  if (projectIds.length === 0) return new Map();
  const rows = await q<{
    project_id: number;
    inv_count: string;
    billed_count: string;
    paid_count: string;
    invoiced_total: string;
    billed_total: string;
    paid_total: string;
  }>(
    `SELECT project_id,
            COUNT(*)                                             AS inv_count,
            COUNT(*) FILTER (WHERE billed OR paid)               AS billed_count,
            COUNT(*) FILTER (WHERE paid)                         AS paid_count,
            SUM(amount)                                          AS invoiced_total,
            SUM(CASE WHEN billed OR paid THEN amount ELSE 0 END) AS billed_total,
            SUM(CASE WHEN paid THEN amount ELSE 0 END)           AS paid_total
       FROM project_invoices
      WHERE project_id = ANY($1::int[])
      GROUP BY project_id`,
    [projectIds]
  );
  return new Map(
    rows.map((r) => [
      r.project_id,
      {
        count: Number(r.inv_count),
        billedCount: Number(r.billed_count),
        paidCount: Number(r.paid_count),
        invoiced: Number(r.invoiced_total),
        billed: Number(r.billed_total),
        paid: Number(r.paid_total),
      },
    ])
  );
}

/** A project with its invoice rows already reduced to the billing numbers. */
export interface BillingProjectRow {
  project: Project;
  tally: InvoiceTally;
  /** Hours logged on the job — the labour behind the invoice. */
  hours: number;
  /** Who closed the job out, when somebody has. */
  closed_by_name: string | null;
}

/**
 * Every job the billing desk could care about, with its invoice totals rolled
 * up in the same query. Jobs that are neither complete nor invoiced are left
 * out here rather than filtered in the page: an unfinished job with nothing
 * raised against it is the project manager's problem, not the biller's.
 *
 * Ordered oldest-completion-first, because that's the order the work wants
 * doing — the job that has been sitting longest is the one to bill next.
 */
export async function listBillingProjects(): Promise<BillingProjectRow[]> {
  const rows = await q<
    Project & {
      inv_count: string;
      billed_count: string;
      paid_count: string;
      invoiced_total: string;
      billed_total: string;
      paid_total: string;
      hours: string;
      closed_by_name: string | null;
    }
  >(
    `SELECT p.*,
            COALESCE(i.inv_count, 0)      AS inv_count,
            COALESCE(i.billed_count, 0)   AS billed_count,
            COALESCE(i.paid_count, 0)     AS paid_count,
            COALESCE(i.invoiced_total, 0) AS invoiced_total,
            COALESCE(i.billed_total, 0)   AS billed_total,
            COALESCE(i.paid_total, 0)     AS paid_total,
            COALESCE(t.hours, 0)          AS hours,
            u.name                        AS closed_by_name
       FROM projects p
       LEFT JOIN (
         SELECT project_id,
                COUNT(*)                                            AS inv_count,
                COUNT(*) FILTER (WHERE billed OR paid)              AS billed_count,
                COUNT(*) FILTER (WHERE paid)                        AS paid_count,
                SUM(amount)                                         AS invoiced_total,
                SUM(CASE WHEN billed OR paid THEN amount ELSE 0 END) AS billed_total,
                SUM(CASE WHEN paid THEN amount ELSE 0 END)          AS paid_total
           FROM project_invoices
          GROUP BY project_id
       ) i ON i.project_id = p.id
       LEFT JOIN (
         SELECT project_id,
                SUM(EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600) AS hours
           FROM time_entries
          WHERE clock_out IS NOT NULL
          GROUP BY project_id
       ) t ON t.project_id = p.id
       LEFT JOIN users u ON u.id = p.billing_closed_by
      WHERE p.status = 'completed' OR i.inv_count > 0
      ORDER BY p.completed_at NULLS LAST, p.id`
  );

  return rows.map((r) => ({
    project: r as Project,
    tally: {
      count: Number(r.inv_count),
      billedCount: Number(r.billed_count),
      paidCount: Number(r.paid_count),
      invoiced: Number(r.invoiced_total),
      billed: Number(r.billed_total),
      paid: Number(r.paid_total),
    },
    hours: Number(r.hours),
    closed_by_name: r.closed_by_name,
  }));
}

export async function deleteProject(id: number): Promise<void> {
  await q('DELETE FROM projects WHERE id = $1', [id]);
}

/* ----------------------------------------------------- Project invoices */

/**
 * One project's invoices, each carrying what is known about its attached PDF —
 * the name and the size, never the bytes, so a listing stays small however
 * many megabytes of paperwork hang off it.
 */
export async function listProjectInvoices(projectId: number): Promise<ProjectInvoiceWithFile[]> {
  return q<ProjectInvoiceWithFile>(
    `SELECT i.*, f.filename AS pdf_filename, f.size AS pdf_size
       FROM project_invoices i
       LEFT JOIN invoice_files f ON f.invoice_id = i.id
      WHERE i.project_id = $1
      ORDER BY i.position, i.id`,
    [projectId]
  );
}

/** Append an invoice to a project, ordered after the existing ones. */
export async function addProjectInvoice(inv: {
  project_id: number;
  invoice_number?: string | null;
  po_number?: string | null;
  amount?: number;
  billed?: boolean;
  sent_on?: string | null;
  paid?: boolean;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO project_invoices
       (project_id, invoice_number, po_number, amount, billed, sent_on, paid, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
       (SELECT COALESCE(MAX(position), 0) + 1 FROM project_invoices WHERE project_id = $1))
     RETURNING id`,
    [
      inv.project_id,
      inv.invoice_number ?? null,
      inv.po_number ?? null,
      inv.amount ?? 0,
      inv.billed ?? false,
      inv.sent_on ?? null,
      inv.paid ?? false,
    ]
  );
  return row!.id;
}

export async function updateProjectInvoice(
  id: number,
  fields: Partial<
    Pick<
      ProjectInvoice,
      'invoice_number' | 'po_number' | 'amount' | 'billed' | 'sent_on' | 'paid'
    >
  >
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const set = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  const values = entries.map(([, v]) => v);
  await q(
    `UPDATE project_invoices SET ${set}, updated_at = now() WHERE id = $${entries.length + 1}`,
    [...values, id]
  );
}

/** Keep an invoice's place in the project's list (1-based). */
export async function setProjectInvoicePosition(id: number, position: number): Promise<void> {
  await q('UPDATE project_invoices SET position = $1 WHERE id = $2', [position, id]);
}

export async function deleteProjectInvoice(id: number): Promise<void> {
  await q('DELETE FROM project_invoices WHERE id = $1', [id]);
}

/* ------------------------------------------------------ Invoice PDFs */

/**
 * Attach the invoice PDF, replacing whatever was there — one invoice has one
 * invoice document, and re-uploading is how you correct it. The bytes go in as
 * a base64 data URL, the same way project files are stored.
 */
export async function setInvoiceFile(file: {
  invoice_id: number;
  filename: string;
  mime: string | null;
  size: number;
  data: string;
  uploaded_by: number | null;
  uploader_name: string | null;
}): Promise<void> {
  await q(
    `INSERT INTO invoice_files
       (invoice_id, filename, mime, size, data, uploaded_by, uploader_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (invoice_id) DO UPDATE SET
       filename = EXCLUDED.filename,
       mime = EXCLUDED.mime,
       size = EXCLUDED.size,
       data = EXCLUDED.data,
       uploaded_by = EXCLUDED.uploaded_by,
       uploader_name = EXCLUDED.uploader_name,
       created_at = now()`,
    [
      file.invoice_id,
      file.filename,
      file.mime,
      file.size,
      file.data,
      file.uploaded_by,
      file.uploader_name,
    ]
  );
}

/**
 * The attached PDF with its bytes, plus the project it hangs off so the route
 * serving it can authorize against the job rather than trusting the id.
 */
export async function getInvoiceFile(invoiceId: number): Promise<InvoiceFile | undefined> {
  return one<InvoiceFile>(
    `SELECT f.*, i.project_id
       FROM invoice_files f
       JOIN project_invoices i ON i.id = f.invoice_id
      WHERE f.invoice_id = $1`,
    [invoiceId]
  );
}

export async function deleteInvoiceFile(invoiceId: number): Promise<void> {
  await q('DELETE FROM invoice_files WHERE invoice_id = $1', [invoiceId]);
}

/** Whether an invoice belongs to a given job — the check before writing to it. */
export async function invoiceBelongsToProject(
  invoiceId: number,
  projectId: number
): Promise<boolean> {
  const row = await one<{ id: number }>(
    'SELECT id FROM project_invoices WHERE id = $1 AND project_id = $2',
    [invoiceId, projectId]
  );
  return !!row;
}

/* -------------------------------------------------------- Project files */

export async function listProjectFiles(projectId: number): Promise<ProjectFile[]> {
  // Deliberately omit `data` (the base64 blob) from listings.
  return q<ProjectFile>(
    `SELECT id, project_id, filename, mime, size, uploaded_by, uploader_name, created_at
     FROM project_files WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
}

export async function getProjectFile(
  id: number
): Promise<(ProjectFile & { data: string }) | undefined> {
  return one<ProjectFile & { data: string }>('SELECT * FROM project_files WHERE id = $1', [id]);
}

export async function addProjectFile(f: {
  project_id: number;
  filename: string;
  mime: string | null;
  size: number;
  data: string;
  uploaded_by: number | null;
  uploader_name: string | null;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO project_files (project_id, filename, mime, size, data, uploaded_by, uploader_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [f.project_id, f.filename, f.mime, f.size, f.data, f.uploaded_by, f.uploader_name]
  );
  return row!.id;
}

export async function deleteProjectFile(id: number): Promise<void> {
  await q('DELETE FROM project_files WHERE id = $1', [id]);
}

/* ------------------------------------------------------------- Job receipts */

/** The receipt columns worth listing — everything except nothing, since the
 *  photo lives in its own table. Spelled out so the shape is visible here
 *  rather than implied by `*`. */
const RECEIPT_COLUMNS = `
  r.id, r.project_id, r.vendor, r.purchase_date, r.category,
  r.subtotal, r.tax, r.total, r.note, r.entry_source,
  r.uploaded_by, r.uploader_name, r.created_at, r.updated_at,
  i.filename AS image_filename, i.mime AS image_mime, i.size AS image_size,
  (i.thumb IS NOT NULL) AS has_thumb`;

/**
 * Every receipt on a job, each with its line items.
 *
 * Two queries rather than one per receipt: the items for the whole job come
 * back in a single pass and are stitched on by id, the same shape the backup
 * builder uses to fetch files for many projects at once.
 *
 * Newest paper first, and a receipt whose date nobody has typed yet sorts last
 * rather than to the top — it is unfinished, not urgent.
 */
export async function listProjectReceipts(projectId: number): Promise<ReceiptWithItems[]> {
  const receipts = await q<ProjectReceipt>(
    `SELECT ${RECEIPT_COLUMNS}
       FROM project_receipts r
       LEFT JOIN receipt_images i ON i.receipt_id = r.id
      WHERE r.project_id = $1
      ORDER BY r.purchase_date DESC NULLS LAST, r.id DESC`,
    [projectId]
  );
  if (receipts.length === 0) return [];

  const items = await q<ReceiptLineItem>(
    `SELECT li.id, li.receipt_id, li.position, li.description,
            li.quantity, li.unit_price, li.amount
       FROM receipt_line_items li
       JOIN project_receipts r ON r.id = li.receipt_id
      WHERE r.project_id = $1
      ORDER BY li.receipt_id, li.position, li.id`,
    [projectId]
  );

  const byReceipt = new Map<number, ReceiptLineItem[]>();
  for (const it of items) {
    const list = byReceipt.get(it.receipt_id);
    if (list) list.push(it);
    else byReceipt.set(it.receipt_id, [it]);
  }
  return receipts.map((r) => ({ ...r, items: byReceipt.get(r.id) ?? [] }));
}

/** One receipt with its items — for re-opening it in the form. */
export async function getReceipt(id: number): Promise<ReceiptWithItems | undefined> {
  const receipt = await one<ProjectReceipt>(
    `SELECT ${RECEIPT_COLUMNS}
       FROM project_receipts r
       LEFT JOIN receipt_images i ON i.receipt_id = r.id
      WHERE r.id = $1`,
    [id]
  );
  if (!receipt) return undefined;
  const items = await q<ReceiptLineItem>(
    `SELECT id, receipt_id, position, description, quantity, unit_price, amount
       FROM receipt_line_items WHERE receipt_id = $1 ORDER BY position, id`,
    [id]
  );
  return { ...receipt, items };
}

/** The photo's bytes. The only place the blob is read. */
export async function getReceiptImage(receiptId: number): Promise<ReceiptImage | undefined> {
  return one<ReceiptImage>('SELECT * FROM receipt_images WHERE receipt_id = $1', [receiptId]);
}

/** Whether a receipt belongs to a given job — the check before writing to it. */
export async function receiptBelongsToProject(
  receiptId: number,
  projectId: number
): Promise<boolean> {
  const row = await one<{ id: number }>(
    'SELECT id FROM project_receipts WHERE id = $1 AND project_id = $2',
    [receiptId, projectId]
  );
  return !!row;
}

/**
 * Write a receipt's line items, replacing whatever was there.
 *
 * Takes the client rather than using q() so the inserts join the caller's
 * transaction — mirrors replaceItems for quote lines. Delete-and-reinsert is
 * safe here because nothing references a line item's id.
 */
async function replaceReceiptItems(
  client: PoolClient,
  receiptId: number,
  items: ReceiptInput['items']
): Promise<void> {
  await client.query('DELETE FROM receipt_line_items WHERE receipt_id = $1', [receiptId]);
  for (const [i, it] of items.entries()) {
    await client.query(
      `INSERT INTO receipt_line_items
         (receipt_id, position, description, quantity, unit_price, amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [receiptId, i, it.description, it.quantity, it.unit_price, it.amount]
    );
  }
}

const RECEIPT_WRITE_VALUES = (r: ReceiptInput) => [
  r.vendor,
  r.purchase_date,
  r.category,
  r.subtotal,
  r.tax,
  r.total,
  r.note,
  r.entry_source,
];

/** A receipt and its items in one transaction. Returns the new id. */
export async function createReceiptWithItems(
  input: ReceiptInput,
  by: { user_id: number | null; user_name: string | null }
): Promise<number> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `INSERT INTO project_receipts
         (project_id, vendor, purchase_date, category, subtotal, tax, total, note,
          entry_source, uploaded_by, uploader_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [input.project_id, ...RECEIPT_WRITE_VALUES(input), by.user_id, by.user_name]
    );
    const id = res.rows[0].id as number;
    await replaceReceiptItems(client, id, input.items);
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Replace a receipt's fields and its whole item set in one transaction.
 *
 * Leaves the photo alone — that is changed only through setReceiptImage or
 * deleteReceiptImage, so editing the numbers can never drop the paper.
 */
export async function updateReceiptWithItems(id: number, input: ReceiptInput): Promise<void> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE project_receipts SET
         vendor = $2, purchase_date = $3, category = $4, subtotal = $5,
         tax = $6, total = $7, note = $8, entry_source = $9, updated_at = now()
       WHERE id = $1`,
      [id, ...RECEIPT_WRITE_VALUES(input)]
    );
    await replaceReceiptItems(client, id, input.items);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Attach or replace a receipt's photo. One receipt, one image. */
export async function setReceiptImage(img: {
  receipt_id: number;
  filename: string;
  mime: string | null;
  size: number;
  data: string;
  thumb: string | null;
  uploaded_by: number | null;
  uploader_name: string | null;
}): Promise<void> {
  await q(
    `INSERT INTO receipt_images
       (receipt_id, filename, mime, size, data, thumb, uploaded_by, uploader_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (receipt_id) DO UPDATE SET
       filename = EXCLUDED.filename,
       mime = EXCLUDED.mime,
       size = EXCLUDED.size,
       data = EXCLUDED.data,
       thumb = EXCLUDED.thumb,
       uploaded_by = EXCLUDED.uploaded_by,
       uploader_name = EXCLUDED.uploader_name,
       created_at = now()`,
    [
      img.receipt_id,
      img.filename,
      img.mime,
      img.size,
      img.data,
      img.thumb,
      img.uploaded_by,
      img.uploader_name,
    ]
  );
}

export async function deleteReceiptImage(receiptId: number): Promise<void> {
  await q('DELETE FROM receipt_images WHERE receipt_id = $1', [receiptId]);
}

/** Items and the photo go with it, both ON DELETE CASCADE. */
export async function deleteReceipt(id: number): Promise<void> {
  await q('DELETE FROM project_receipts WHERE id = $1', [id]);
}

/* ------------------------------------------------------------------ Notes */

export async function listNotes(projectId: number): Promise<Note[]> {
  return q<Note>('SELECT * FROM notes WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
}

export async function addNote(
  projectId: number,
  userId: number,
  authorName: string,
  body: string
): Promise<void> {
  await q('INSERT INTO notes (project_id, user_id, author_name, body) VALUES ($1,$2,$3,$4)', [
    projectId,
    userId,
    authorName,
    body,
  ]);
}

export async function deleteNote(id: number): Promise<void> {
  await q('DELETE FROM notes WHERE id = $1', [id]);
}

/* ------------------------------------------------------------- Time clock */

export interface TimeEntryWithUser extends TimeEntry {
  user_name: string;
  project_name?: string | null;
  customer?: string | null;
  break_minutes?: number;
}

/** An open (unclosed) time entry with the current break state, if any. */
export interface ActiveEntry extends TimeEntry {
  project_name: string | null;
  customer: string | null;
  on_break: boolean;
  break_start: string | null;
}

/** The user's currently-open time entry, if any. */
export async function activeEntry(userId: number): Promise<ActiveEntry | undefined> {
  return one<ActiveEntry>(
    `SELECT t.*, p.name AS project_name, p.customer,
            b.break_start,
            (b.id IS NOT NULL) AS on_break
     FROM time_entries t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN time_breaks b ON b.time_entry_id = t.id AND b.break_end IS NULL
     WHERE t.user_id = $1 AND t.clock_out IS NULL
     ORDER BY t.clock_in DESC LIMIT 1`,
    [userId]
  );
}

/** Clock in. A null projectId is a general clock-in not tied to a job. */
export async function clockIn(
  userId: number,
  projectId: number | null
): Promise<{ ok: boolean; error?: string }> {
  if (await activeEntry(userId)) {
    return { ok: false, error: 'You are already clocked in. Clock out first.' };
  }
  await q('INSERT INTO time_entries (project_id, user_id, clock_in) VALUES ($1, $2, now())', [
    projectId,
    userId,
  ]);
  return { ok: true };
}

/** Lock and return the user's open entry inside a transaction, so clock-out
 *  and job-switch can't race each other from two devices. Returns undefined
 *  when the user isn't clocked in. */
async function lockActiveEntry(
  client: PoolClient,
  userId: number
): Promise<{ id: number; project_id: number | null } | undefined> {
  const { rows } = await client.query(
    `SELECT id, project_id FROM time_entries
     WHERE user_id = $1 AND clock_out IS NULL
     ORDER BY clock_in DESC LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  return rows[0] as { id: number; project_id: number | null } | undefined;
}

export async function clockOut(userId: number, note?: string): Promise<{ ok: boolean; error?: string }> {
  // A shift synopsis is mandatory on the final clock-out: at least 5
  // non-whitespace characters so "ok" or a stray space can't slip through.
  if (!isValidSynopsis(note)) {
    return { ok: false, error: SYNOPSIS_ERROR };
  }
  const pool = await getDb();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = await lockActiveEntry(client, userId);
    if (!entry) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'You are not clocked in.' };
    }
    // Close any lunch break still running so the shift total stays accurate.
    await client.query(
      'UPDATE time_breaks SET break_end = now() WHERE time_entry_id = $1 AND break_end IS NULL',
      [entry.id]
    );
    await client.query('UPDATE time_entries SET clock_out = now(), note = $1 WHERE id = $2', [
      note!.trim(),
      entry.id,
    ]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('clockOut failed', err);
    return { ok: false, error: 'Could not clock out. Please try again.' };
  } finally {
    client.release();
  }
}

/** Switch jobs mid-shift: atomically close the active entry (ending any
 *  running break) and open a new entry on the target job, so the worker's
 *  clock keeps running with no gap. The segment note is optional — the
 *  mandatory-synopsis rule only applies to the final clock-out. */
export async function switchJob(
  userId: number,
  projectId: number | null,
  note?: string
): Promise<{ ok: boolean; error?: string }> {
  const pool = await getDb();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = await lockActiveEntry(client, userId);
    if (!entry) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'You are not clocked in.' };
    }
    if ((entry.project_id ?? null) === (projectId ?? null)) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'You are already clocked in on that job.' };
    }
    // Close any running lunch break at the switch, mirroring clockOut.
    await client.query(
      'UPDATE time_breaks SET break_end = now() WHERE time_entry_id = $1 AND break_end IS NULL',
      [entry.id]
    );
    await client.query('UPDATE time_entries SET clock_out = now(), note = $1 WHERE id = $2', [
      note?.trim() || null,
      entry.id,
    ]);
    await client.query(
      'INSERT INTO time_entries (project_id, user_id, clock_in) VALUES ($1, $2, now())',
      [projectId, userId]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('switchJob failed', err);
    return { ok: false, error: 'Could not switch jobs. Please refresh and try again.' };
  } finally {
    client.release();
  }
}

/** Start a lunch break on the user's active shift. */
export async function startBreak(userId: number): Promise<{ ok: boolean; error?: string }> {
  const entry = await activeEntry(userId);
  if (!entry) return { ok: false, error: 'Clock in before starting a break.' };
  if (entry.on_break) return { ok: false, error: 'You are already on a break.' };
  await q('INSERT INTO time_breaks (time_entry_id, break_start) VALUES ($1, now())', [entry.id]);
  return { ok: true };
}

/** End the running lunch break on the user's active shift. */
export async function endBreak(userId: number): Promise<{ ok: boolean; error?: string }> {
  const entry = await activeEntry(userId);
  if (!entry) return { ok: false, error: 'You are not clocked in.' };
  if (!entry.on_break) return { ok: false, error: 'You are not on a break.' };
  await q('UPDATE time_breaks SET break_end = now() WHERE time_entry_id = $1 AND break_end IS NULL', [
    entry.id,
  ]);
  return { ok: true };
}

export async function listProjectTime(projectId: number): Promise<TimeEntryWithUser[]> {
  return q<TimeEntryWithUser>(
    `SELECT t.*, u.name AS user_name
     FROM time_entries t JOIN users u ON u.id = t.user_id
     WHERE t.project_id = $1 ORDER BY t.clock_in DESC`,
    [projectId]
  );
}

export async function listUserTime(userId: number, limit = 50): Promise<TimeEntryWithUser[]> {
  return q<TimeEntryWithUser>(
    `SELECT t.*, u.name AS user_name, p.name AS project_name, p.customer,
            ROUND(COALESCE((
              SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(b.break_end, t.clock_out, now()) - b.break_start)))
              FROM time_breaks b WHERE b.time_entry_id = t.id
            ), 0) / 60.0) AS break_minutes
     FROM time_entries t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.user_id = $1 ORDER BY t.clock_in DESC LIMIT $2`,
    [userId, limit]
  );
}

export async function listRecentTime(limit = 25): Promise<TimeEntryWithUser[]> {
  return q<TimeEntryWithUser>(
    `SELECT t.*, u.name AS user_name, p.name AS project_name, p.customer
     FROM time_entries t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN projects p ON p.id = t.project_id
     ORDER BY t.clock_in DESC LIMIT $1`,
    [limit]
  );
}

/** Everyone currently clocked in (open entries), across all projects. */
export async function listActiveClockIns(): Promise<(TimeEntryWithUser & { on_break: boolean })[]> {
  return q<TimeEntryWithUser & { on_break: boolean }>(
    `SELECT t.*, u.name AS user_name, p.name AS project_name, p.customer,
            EXISTS (
              SELECT 1 FROM time_breaks b WHERE b.time_entry_id = t.id AND b.break_end IS NULL
            ) AS on_break
     FROM time_entries t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.clock_out IS NULL ORDER BY t.clock_in ASC`
  );
}

/** Total logged hours for a project (closed entries only, minus breaks). */
export async function projectHours(projectId: number): Promise<number> {
  const row = await one<{ hours: number }>(
    `SELECT COALESCE(SUM(
              EXTRACT(EPOCH FROM (t.clock_out - t.clock_in))
              - COALESCE((
                  SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(b.break_end, t.clock_out) - b.break_start)))
                  FROM time_breaks b WHERE b.time_entry_id = t.id
                ), 0)
            ), 0) / 3600.0 AS hours
     FROM time_entries t
     WHERE t.project_id = $1 AND t.clock_out IS NOT NULL`,
    [projectId]
  );
  return Math.max(0, row?.hours ?? 0);
}

/** Net hours (minus breaks) the user has logged in the last 7 days. */
export async function weekNetHours(userId: number): Promise<number> {
  const row = await one<{ hours: number }>(
    `SELECT COALESCE(SUM(
              EXTRACT(EPOCH FROM (t.clock_out - t.clock_in))
              - COALESCE((
                  SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(b.break_end, t.clock_out) - b.break_start)))
                  FROM time_breaks b WHERE b.time_entry_id = t.id
                ), 0)
            ), 0) / 3600.0 AS hours
     FROM time_entries t
     WHERE t.user_id = $1 AND t.clock_out IS NOT NULL
       AND t.clock_in > now() - INTERVAL '7 days'`,
    [userId]
  );
  return Math.max(0, row?.hours ?? 0);
}

/* ------------------------------------------- Time clock: payroll review */

export interface AdminTimeEntry {
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
  check_number: string | null;
  break_minutes: number;
  net_hours: number;
}

export interface AdminWeekUser {
  user_id: number;
  user_name: string;
  /** Hourly pay rate (manager/admin-only page). NULL = no rate set. */
  hourly_rate: number | null;
  entries: AdminTimeEntry[];
  total_hours: number;
  paid_hours: number;
  unpaid_hours: number;
  closed_count: number;
  all_paid: boolean;
  /** Weekly approval (manager sign-off), when one exists for this user-week. */
  approved_at: string | null;
  approved_by_name: string | null;
  /** Check number(s) recorded when the week was marked paid: the distinct
   *  non-null values across the week's paid entries, comma-joined when a
   *  week was paid across multiple checks. */
  check_number: string | null;
}

export interface AdminWeek {
  week_start: string;
  users: AdminWeekUser[];
  total_hours: number;
  unpaid_hours: number;
  fully_paid: boolean;
}

/**
 * Time entries for the last `weeks` weeks, grouped by ISO week (Mon-start)
 * and then by employee, with break-adjusted net hours and paid status.
 */
export async function adminTimeByWeek(weeks = 8): Promise<AdminWeek[]> {
  const rows = await q<{
    id: number;
    user_id: number;
    user_name: string;
    hourly_rate: number | null;
    project_id: number | null;
    project_name: string | null;
    customer: string | null;
    clock_in: string;
    clock_out: string | null;
    note: string | null;
    paid: boolean;
    check_number: string | null;
    week_start: string;
    break_seconds: number;
  }>(
    `SELECT t.id, t.user_id, u.name AS user_name, u.hourly_rate,
            t.project_id, p.name AS project_name, p.customer,
            t.clock_in, t.clock_out, t.note, t.paid, t.check_number,
            to_char(date_trunc('week', t.clock_in), 'YYYY-MM-DD') AS week_start,
            COALESCE((
              SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(b.break_end, t.clock_out, now()) - b.break_start)))
              FROM time_breaks b WHERE b.time_entry_id = t.id
            ), 0) AS break_seconds
     FROM time_entries t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.clock_in >= date_trunc('week', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 week')
     ORDER BY t.clock_in DESC`,
    [weeks]
  );

  // Weekly approvals in the same window, keyed by "week:user" for the merge.
  const approvalRows = await q<{
    week_start: string;
    user_id: number;
    approved_at: string;
    approved_by_name: string | null;
  }>(
    `SELECT to_char(a.week_start, 'YYYY-MM-DD') AS week_start, a.user_id, a.approved_at,
            ap.name AS approved_by_name
     FROM time_week_approvals a
     LEFT JOIN users ap ON ap.id = a.approved_by
     WHERE a.week_start >= date_trunc('week', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 week')`,
    [weeks]
  );
  const approvals = new Map(
    approvalRows.map((a) => [`${a.week_start}:${a.user_id}`, a] as const)
  );

  const weekMap = new Map<string, Map<number, AdminWeekUser>>();

  for (const r of rows) {
    const breakMinutes = Math.round(r.break_seconds / 60);
    const gross = hoursBetween(r.clock_in, r.clock_out);
    const netHours = Math.max(0, gross - r.break_seconds / 3600);

    const entry: AdminTimeEntry = {
      id: r.id,
      user_id: r.user_id,
      user_name: r.user_name,
      project_id: r.project_id,
      project_name: r.project_name,
      customer: r.customer,
      clock_in: r.clock_in,
      clock_out: r.clock_out,
      note: r.note,
      paid: r.paid,
      check_number: r.check_number,
      break_minutes: breakMinutes,
      net_hours: netHours,
    };

    let byUser = weekMap.get(r.week_start);
    if (!byUser) {
      byUser = new Map();
      weekMap.set(r.week_start, byUser);
    }
    let u = byUser.get(r.user_id);
    if (!u) {
      const approval = approvals.get(`${r.week_start}:${r.user_id}`);
      u = {
        user_id: r.user_id,
        user_name: r.user_name,
        hourly_rate: r.hourly_rate,
        entries: [],
        total_hours: 0,
        paid_hours: 0,
        unpaid_hours: 0,
        closed_count: 0,
        all_paid: true,
        approved_at: approval?.approved_at ?? null,
        approved_by_name: approval?.approved_by_name ?? null,
        check_number: null,
      };
      byUser.set(r.user_id, u);
    }
    u.entries.push(entry);
    if (r.clock_out) {
      u.total_hours += netHours;
      u.closed_count += 1;
      if (r.paid) u.paid_hours += netHours;
      else {
        u.unpaid_hours += netHours;
        u.all_paid = false;
      }
    }
  }

  const weeks_out: AdminWeek[] = [...weekMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([week_start, byUser]) => {
      const users = [...byUser.values()].sort((a, b) => a.user_name.localeCompare(b.user_name));
      for (const u of users) {
        const checks = [
          ...new Set(
            u.entries.filter((e) => e.paid && e.check_number).map((e) => e.check_number as string)
          ),
        ];
        u.check_number = checks.length > 0 ? checks.join(', ') : null;
      }
      const total_hours = users.reduce((s, u) => s + u.total_hours, 0);
      const unpaid_hours = users.reduce((s, u) => s + u.unpaid_hours, 0);
      return {
        week_start,
        users,
        total_hours,
        unpaid_hours,
        fully_paid: users.every((u) => u.all_paid),
      };
    });

  return weeks_out;
}

/** Mark a single time entry paid/unpaid. Unmarking clears the check number. */
export async function setEntryPaid(entryId: number, paid: boolean, adminId: number): Promise<void> {
  await q(
    `UPDATE time_entries
     SET paid = $1,
         paid_at = CASE WHEN $1 THEN now() ELSE NULL END,
         paid_by = CASE WHEN $1 THEN $2::int ELSE NULL END,
         check_number = CASE WHEN $1 THEN check_number ELSE NULL END
     WHERE id = $3`,
    [paid, adminId, entryId]
  );
}

/** Mark every closed entry for a user in a given ISO week paid/unpaid,
 *  recording the payroll check number when marking paid (cleared when
 *  unmarking). When marking paid without a check number, any check number
 *  already recorded on an entry is preserved rather than erased. */
export async function setWeekPaid(
  userId: number,
  weekStart: string,
  paid: boolean,
  adminId: number,
  checkNumber?: string | null
): Promise<void> {
  const check = paid ? (checkNumber?.trim() || null) : null;
  await q(
    `UPDATE time_entries
     SET paid = $1,
         paid_at = CASE WHEN $1 THEN now() ELSE NULL END,
         paid_by = CASE WHEN $1 THEN $2::int ELSE NULL END,
         check_number = CASE WHEN $1 THEN COALESCE($5, check_number) ELSE NULL END
     WHERE user_id = $3
       AND clock_out IS NOT NULL
       AND date_trunc('week', clock_in) = date_trunc('week', $4::date)`,
    [paid, adminId, userId, weekStart, check]
  );
}

/* --------------------------------------- Time clock: weekly approval */

/**
 * Record a manager's sign-off on one employee's week. Idempotent: the first
 * approval wins, so re-approving (e.g. clicking the email link twice) never
 * overwrites who approved or when.
 */
export async function approveWeek(
  userId: number,
  weekStart: string,
  approvedBy: number,
  via: 'app' | 'email'
): Promise<void> {
  await q(
    `INSERT INTO time_week_approvals (user_id, week_start, approved_by, via)
     VALUES ($1, date_trunc('week', $2::date)::date, $3, $4)
     ON CONFLICT (user_id, week_start) DO NOTHING`,
    [userId, weekStart, approvedBy, via]
  );
}

export interface ReportWeekSummary {
  user_id: number;
  user_name: string;
  /** Net hours per day, Monday..Sunday of the week (7 entries). */
  days: { date: string; hours: number }[];
  total_hours: number;
  /** Shift notes left during the week, in clock-in order. */
  notes: string[];
  approved: boolean;
  approved_at: string | null;
  approved_by_name: string | null;
}

export interface ManagerWeekSummary {
  manager_id: number;
  manager_name: string;
  week_start: string;
  reports: ReportWeekSummary[];
}

/**
 * One manager's approval view of a Monday-start week: every ACTIVE direct
 * report with their per-day net hours (breaks deducted; closed shifts only),
 * weekly total, shift notes, and whether the week is already approved.
 * Reports with no time still appear (all-zero days) so nothing is missed.
 *
 * Days and weeks are bucketed with date_trunc/to_char in the DATABASE's
 * timezone — the same basis as adminTimeByWeek and setWeekPaid — so the
 * emailed week and the in-app timesheet week always agree. (PAYROLL_TZ only
 * decides WHEN the Monday email fires, not how hours are bucketed.)
 */
export async function managerWeekSummary(
  managerId: number,
  weekStart: string
): Promise<ManagerWeekSummary> {
  const manager = await one<{ id: number; name: string }>(
    'SELECT id, name FROM users WHERE id = $1',
    [managerId]
  );

  // Normalize whatever date was passed to that week's Monday.
  const weekRow = await one<{ week_start: string }>(
    `SELECT to_char(date_trunc('week', $1::date), 'YYYY-MM-DD') AS week_start`,
    [weekStart]
  );
  const monday = weekRow!.week_start;

  const reports = await q<{ id: number; name: string }>(
    'SELECT id, name FROM users WHERE manager_id = $1 AND active = 1 ORDER BY name',
    [managerId]
  );

  const days: string[] = (
    await q<{ d: string }>(
      `SELECT to_char(gs, 'YYYY-MM-DD') AS d
       FROM generate_series($1::date, $1::date + 6, INTERVAL '1 day') gs`,
      [monday]
    )
  ).map((r) => r.d);

  const reportIds = reports.map((r) => r.id);

  const entryRows = reportIds.length
    ? await q<{ user_id: number; day: string; note: string | null; net_hours: number }>(
        `SELECT t.user_id, to_char(t.clock_in, 'YYYY-MM-DD') AS day, t.note,
                (GREATEST(0,
                  EXTRACT(EPOCH FROM (t.clock_out - t.clock_in))
                  - COALESCE((
                      SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(b.break_end, t.clock_out) - b.break_start)))
                      FROM time_breaks b WHERE b.time_entry_id = t.id
                    ), 0)
                ) / 3600.0)::float8 AS net_hours
         FROM time_entries t
         WHERE t.user_id = ANY($1::int[])
           AND t.clock_out IS NOT NULL
           AND date_trunc('week', t.clock_in) = date_trunc('week', $2::date)
         ORDER BY t.clock_in`,
        [reportIds, monday]
      )
    : [];

  const approvalRows = reportIds.length
    ? await q<{ user_id: number; approved_at: string; approved_by_name: string | null }>(
        `SELECT a.user_id, a.approved_at, ap.name AS approved_by_name
         FROM time_week_approvals a
         LEFT JOIN users ap ON ap.id = a.approved_by
         WHERE a.week_start = $1::date AND a.user_id = ANY($2::int[])`,
        [monday, reportIds]
      )
    : [];
  const approvalByUser = new Map(approvalRows.map((a) => [a.user_id, a] as const));

  const summaries: ReportWeekSummary[] = reports.map((r) => {
    const mine = entryRows.filter((e) => e.user_id === r.id);
    const perDay = days.map((date) => ({
      date,
      hours: mine.filter((e) => e.day === date).reduce((s, e) => s + e.net_hours, 0),
    }));
    const approval = approvalByUser.get(r.id);
    return {
      user_id: r.id,
      user_name: r.name,
      days: perDay,
      total_hours: perDay.reduce((s, d) => s + d.hours, 0),
      notes: mine.map((e) => e.note?.trim() ?? '').filter((n) => n !== ''),
      approved: !!approval,
      approved_at: approval?.approved_at ?? null,
      approved_by_name: approval?.approved_by_name ?? null,
    };
  });

  return {
    manager_id: managerId,
    manager_name: manager?.name ?? '',
    week_start: monday,
    reports: summaries,
  };
}

export interface ManagerWithReports {
  id: number;
  name: string;
  personal_email: string | null;
  work_email: string | null;
  email: string;
}

/** Active users who have at least one active direct report. */
export async function listManagersWithReports(): Promise<ManagerWithReports[]> {
  return q<ManagerWithReports>(
    `SELECT DISTINCT m.id, m.name, m.personal_email, m.work_email, m.email
     FROM users m
     JOIN users r ON r.manager_id = m.id AND r.active = 1
     WHERE m.active = 1
     ORDER BY m.name`
  );
}

/* --------------------------------------- Time clock: manual edit / backdate */

/** Fetch a single raw time entry, or undefined if it doesn't exist. */
export async function getTimeEntry(entryId: number): Promise<TimeEntry | undefined> {
  return one<TimeEntry>('SELECT * FROM time_entries WHERE id = $1', [entryId]);
}

interface ManualEntryInput {
  projectId: number | null;
  clockIn: string;
  clockOut: string;
  note?: string | null;
  breakMinutes?: number;
}

/** Validate the shared shape of a manual add/edit, returning the parsed
 *  boundaries or an error message. */
function validateManualEntry(
  input: ManualEntryInput
): { ok: true; startMs: number; breakMin: number } | { ok: false; error: string } {
  const startMs = Date.parse(input.clockIn);
  const endMs = Date.parse(input.clockOut);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return { ok: false, error: 'Enter a valid clock-in and clock-out time.' };
  }
  if (endMs <= startMs) {
    return { ok: false, error: 'Clock-out must be after clock-in.' };
  }
  const breakMin = Math.max(0, Math.round(input.breakMinutes ?? 0));
  const grossMin = (endMs - startMs) / 60000;
  if (breakMin >= grossMin) {
    return { ok: false, error: 'Break time is longer than the shift.' };
  }
  return { ok: true, startMs, breakMin };
}

/** Insert a synthetic break row of `breakMin` minutes starting at clock-in.
 *  Manual entries track break as a single lump rather than start/stop pairs. */
async function writeSyntheticBreak(entryId: number, clockIn: string, startMs: number, breakMin: number) {
  if (breakMin <= 0) return;
  const breakEnd = new Date(startMs + breakMin * 60000).toISOString();
  await q(
    'INSERT INTO time_breaks (time_entry_id, break_start, break_end) VALUES ($1, $2, $3)',
    [entryId, clockIn, breakEnd]
  );
}

/** Create a completed, backdated time entry for a user (e.g. hours worked on a
 *  previous day that weren't clocked live). */
export async function addManualTimeEntry(
  input: ManualEntryInput & { userId: number }
): Promise<{ ok: boolean; error?: string; id?: number }> {
  const v = validateManualEntry(input);
  if (!v.ok) return v;

  const row = await one<{ id: number }>(
    `INSERT INTO time_entries (project_id, user_id, clock_in, clock_out, note)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.projectId, input.userId, input.clockIn, input.clockOut, input.note ?? null]
  );
  const id = row!.id;
  await writeSyntheticBreak(id, input.clockIn, v.startMs, v.breakMin);
  return { ok: true, id };
}

/** Update the times, job, note and break of an existing (closed) entry.
 *  Any recorded breaks are replaced with a single lump of `breakMinutes`. */
export async function updateTimeEntry(
  input: ManualEntryInput & { entryId: number }
): Promise<{ ok: boolean; error?: string }> {
  const v = validateManualEntry(input);
  if (!v.ok) return v;

  await q(
    `UPDATE time_entries
     SET project_id = $1, clock_in = $2, clock_out = $3, note = $4
     WHERE id = $5`,
    [input.projectId, input.clockIn, input.clockOut, input.note ?? null, input.entryId]
  );
  await q('DELETE FROM time_breaks WHERE time_entry_id = $1', [input.entryId]);
  await writeSyntheticBreak(input.entryId, input.clockIn, v.startMs, v.breakMin);
  return { ok: true };
}

/** Delete a time entry (and, via cascade, its break rows). */
export async function deleteTimeEntry(entryId: number): Promise<void> {
  await q('DELETE FROM time_entries WHERE id = $1', [entryId]);
}

/* -------------------------------------------------------------- Dashboard */

export interface QuoteLite {
  id: number;
  quote_number: string | null;
  customer: string;
  project_name: string | null;
  bid_value: number;
  status: QuoteStatus;
}

export interface ProjectLite {
  id: number;
  name: string;
  customer: string;
  value: number;
  status: ProjectStatus;
}

export interface WeekBucket {
  week_start: string;
  count: number;
  value: number;
  quotes: QuoteLite[];
}

export interface DecisionRow {
  id: number;
  quote_number: string | null;
  customer: string;
  project_name: string | null;
  category: string | null;
  bid_value: number;
  status: 'sold' | 'lost';
  updated_at: string;
}

export interface DashboardData {
  totalPipeline: number;
  openPipeline: number;
  soldTotal: number;
  proposalCount: number;
  openQuoteCount: number;
  activeProjectCount: number;
  pipelineByCustomer: { customer: string; value: number; quotes: QuoteLite[] }[];
  soldByStatus: { status: ProjectStatus; label: string; value: number; count: number; projects: ProjectLite[] }[];
  categoryBreakdown: { category: string; value: number }[];
  quotesByWeek: WeekBucket[];
  recentDecisions: DecisionRow[];
}

export async function getDashboard(): Promise<DashboardData> {
  // These queries are independent, so run them concurrently.
  const [
    kpis,
    openQuotes,
    allProjects,
    categoryBreakdown,
    weekStarts,
    allQuotes,
    recentDecisions,
  ] = await Promise.all([
    one<{
      total_pipeline: number;
      open_pipeline: number;
      sold_total: number;
      proposal_count: number;
      open_quote_count: number;
      active_project_count: number;
    }>(
      `SELECT
         (SELECT COALESCE(SUM(bid_value),0) FROM quotes) AS total_pipeline,
         (SELECT COALESCE(SUM(bid_value),0) FROM quotes WHERE status = 'open') AS open_pipeline,
         (SELECT COALESCE(SUM(value),0) FROM projects) AS sold_total,
         (SELECT COUNT(*) FROM quotes) AS proposal_count,
         (SELECT COUNT(*) FROM quotes WHERE status = 'open') AS open_quote_count,
         (SELECT COUNT(*) FROM projects WHERE status != 'completed') AS active_project_count`
    ),
    q<QuoteLite>(
      `SELECT id, quote_number, customer, project_name, bid_value, status
       FROM quotes WHERE status = 'open' ORDER BY bid_value DESC`
    ),
    q<ProjectLite>('SELECT id, name, customer, value, status FROM projects'),
    q<{ category: string; value: number }>(
      `SELECT COALESCE(category,'Uncategorized') AS category, SUM(bid_value) AS value
       FROM quotes WHERE status = 'open' GROUP BY category ORDER BY value DESC`
    ),
    q<{ week_start: string }>(
      `SELECT to_char(gs, 'YYYY-MM-DD') AS week_start
       FROM generate_series(
         date_trunc('week', CURRENT_DATE) - INTERVAL '7 weeks',
         date_trunc('week', CURRENT_DATE),
         INTERVAL '1 week'
       ) gs`
    ),
    q<QuoteLite & { week_start: string }>(
      // Bucket by issue date (falling back to created_at when a quote has no
      // issue date, so nothing silently drops off the chart).
      `SELECT id, quote_number, customer, project_name, bid_value, status,
              to_char(date_trunc('week', COALESCE(issue_date, created_at::date)), 'YYYY-MM-DD') AS week_start
       FROM quotes
       ORDER BY bid_value DESC`
    ),
    q<DecisionRow>(
      `SELECT id, quote_number, customer, project_name, category, bid_value, status, updated_at
       FROM quotes
       WHERE status IN ('sold','lost') AND updated_at >= now() - INTERVAL '14 days'
       ORDER BY updated_at DESC`
    ),
  ]);

  const totalPipeline = kpis!.total_pipeline;
  const openPipeline = kpis!.open_pipeline;
  const soldTotal = kpis!.sold_total;
  const proposalCount = kpis!.proposal_count;
  const openQuoteCount = kpis!.open_quote_count;
  const activeProjectCount = kpis!.active_project_count;

  // Open quotes grouped by customer (with the underlying quotes for drill-down).
  const byCustomer = new Map<string, { customer: string; value: number; quotes: QuoteLite[] }>();
  for (const qt of openQuotes) {
    const entry = byCustomer.get(qt.customer) ?? { customer: qt.customer, value: 0, quotes: [] };
    entry.value += qt.bid_value;
    entry.quotes.push(qt);
    byCustomer.set(qt.customer, entry);
  }
  const pipelineByCustomer = [...byCustomer.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Projects grouped by status (with the underlying projects for drill-down).
  const statusLabels: Record<ProjectStatus, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    completed: 'Completed',
  };
  const order: ProjectStatus[] = ['in_progress', 'not_started', 'completed'];
  const soldByStatus = order.map((s) => {
    const projects = allProjects.filter((p) => p.status === s);
    return {
      status: s,
      label: statusLabels[s],
      value: projects.reduce((sum, p) => sum + p.value, 0),
      count: projects.length,
      projects,
    };
  });

  // Total dollar value of quotes issued in each of the past 8 weeks, bucketed by
  // issue date. Each bar reflects only the quotes issued during that week.
  const quotesByWeek: WeekBucket[] = weekStarts.map((w) => {
    const quotes = allQuotes.filter((qt) => qt.week_start === w.week_start);
    return {
      week_start: w.week_start,
      count: quotes.length,
      value: quotes.reduce((sum, qt) => sum + qt.bid_value, 0),
      quotes: quotes.map(({ week_start, ...rest }) => rest),
    };
  });

  return {
    totalPipeline,
    openPipeline,
    soldTotal,
    proposalCount,
    openQuoteCount,
    activeProjectCount,
    pipelineByCustomer,
    soldByStatus,
    categoryBreakdown,
    quotesByWeek,
    recentDecisions,
  };
}

/* ----------------------------------------------------------------- Backup */

/**
 * Gather everything for a date-range backup. Quotes are selected by their
 * effective date (issue date, falling back to when they were entered) so it
 * matches the dashboard's weekly buckets; projects by creation or start date;
 * time entries by clock-in. Customers and the pricing catalog are reference
 * data and are included in full (not date-filtered). Boundaries are inclusive
 * `YYYY-MM-DD` strings.
 */
export async function getBackupData(from: string, to: string): Promise<BackupData> {
  const quotes = await q<Quote>(
    `SELECT * FROM quotes
      WHERE COALESCE(issue_date, created_at::date) BETWEEN $1 AND $2
      ORDER BY COALESCE(issue_date, created_at::date), id`,
    [from, to]
  );
  const quoteIds = quotes.map((qt) => qt.id);
  const lineItems = quoteIds.length
    ? await q<QuoteLineItem>(
        `SELECT * FROM quote_line_items WHERE quote_id = ANY($1::int[]) ORDER BY quote_id, position, id`,
        [quoteIds]
      )
    : [];
  const itemsByQuote = new Map<number, QuoteLineItem[]>();
  for (const li of lineItems) {
    const list = itemsByQuote.get(li.quote_id) ?? [];
    list.push(li);
    itemsByQuote.set(li.quote_id, list);
  }
  const quotesWithItems: BackupQuote[] = quotes.map((qt) => ({
    ...qt,
    line_items: itemsByQuote.get(qt.id) ?? [],
  }));

  // A project counts as in-range if it was created in the window or its
  // scheduled span [start_date, end_date] overlaps it — so a project that
  // started earlier but was still active during the period is included too.
  const projects = await q<Project>(
    `SELECT * FROM projects
      WHERE created_at::date BETWEEN $1 AND $2
         OR (start_date IS NOT NULL AND start_date <= $2
             AND (end_date IS NULL OR end_date >= $1))
      ORDER BY created_at`,
    [from, to]
  );
  const projectIds = projects.map((p) => p.id);
  // Invoices carry their PDF's name and size (not its bytes) so the workbook
  // can say which invoice a document in the zip belongs to.
  const invoices = projectIds.length
    ? await q<ProjectInvoiceWithFile>(
        `SELECT i.*, f.filename AS pdf_filename, f.size AS pdf_size
           FROM project_invoices i
           LEFT JOIN invoice_files f ON f.invoice_id = i.id
          WHERE i.project_id = ANY($1::int[])
          ORDER BY i.project_id, i.position, i.id`,
        [projectIds]
      )
    : [];
  const notes = projectIds.length
    ? await q<Note>(
        `SELECT * FROM notes WHERE project_id = ANY($1::int[]) ORDER BY project_id, created_at`,
        [projectIds]
      )
    : [];
  // Metadata only — the base64 blob is fetched per file by the client.
  const projectFiles = projectIds.length
    ? await q<BackupProjectFile>(
        `SELECT id, project_id, filename, mime, size, created_at
           FROM project_files WHERE project_id = ANY($1::int[]) ORDER BY project_id, created_at`,
        [projectIds]
      )
    : [];

  const timeRows = await q<{
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
    break_seconds: number;
  }>(
    `SELECT t.id, t.user_id, u.name AS user_name,
            t.project_id, p.name AS project_name, p.customer,
            t.clock_in, t.clock_out, t.note, t.paid,
            COALESCE((
              SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(b.break_end, t.clock_out, now()) - b.break_start)))
              FROM time_breaks b WHERE b.time_entry_id = t.id
            ), 0) AS break_seconds
       FROM time_entries t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.clock_in::date BETWEEN $1 AND $2
      ORDER BY t.clock_in`,
    [from, to]
  );
  const timeEntries: BackupTimeEntry[] = timeRows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_name: r.user_name,
    project_id: r.project_id,
    project_name: r.project_name,
    customer: r.customer,
    clock_in: r.clock_in,
    clock_out: r.clock_out,
    note: r.note,
    paid: r.paid,
    // Both figures only make sense for a closed shift. For an open entry the
    // break total is measured against now() and would grow unboundedly, so
    // export 0 to stay consistent with the 0 net hours.
    break_minutes: r.clock_out ? Math.round(r.break_seconds / 60) : 0,
    net_hours: r.clock_out
      ? Math.max(0, hoursBetween(r.clock_in, r.clock_out) - r.break_seconds / 3600)
      : 0,
  }));

  const [customers, pricing, subcontractors, schedule] = await Promise.all([
    listCustomersWithContacts(),
    listPricingItems(),
    q<Subcontractor>('SELECT * FROM subcontractors ORDER BY name'),
    backupSchedule(projectIds),
  ]);

  return {
    quotes: quotesWithItems,
    projects,
    invoices,
    notes,
    projectFiles,
    timeEntries,
    customers,
    pricing,
    subcontractors,
    schedule,
  };
}

/**
 * Scheduled phases for the exported projects, with their real dates resolved.
 * The dependency solver runs per project so a chain resolves against its own
 * job, and the crew is flattened to one column for the spreadsheet.
 */
async function backupSchedule(projectIds: number[]): Promise<BackupSchedulePhase[]> {
  if (projectIds.length === 0) return [];

  const rows = await q<{
    id: number;
    project_id: number;
    project_name: string;
    name: string;
    start_date: string;
    duration_days: number;
    depends_on_id: number | null;
    depends_type: DependsType;
    lag_days: number;
    crew_size: number;
    subcontractor_name: string | null;
    status: TaskStatus;
    start_time: string | null;
    hours: number | null;
    notes: string | null;
    position: number;
    crew: { name: string; days: number }[] | null;
  }>(
    // depends_type comes along so the solver resolves start-to-start links the
    // same way the app does — otherwise an overlapping phase would export with
    // finish-to-start dates. Crew is booked a day at a time, so it's rolled up
    // to one row per person with their day count for the spreadsheet.
    `SELECT t.id, t.project_id, p.name AS project_name, t.name,
            t.start_date, t.duration_days, t.depends_on_id, t.depends_type, t.lag_days,
            t.crew_size, sub.name AS subcontractor_name,
            t.status, t.start_time, t.hours, t.notes, t.position,
            (SELECT json_agg(json_build_object('name', person, 'days', days)
                             ORDER BY person)
               FROM (SELECT COALESCE(u.name, s.name) AS person, COUNT(*)::int AS days
                       FROM schedule_crew_days c
                       LEFT JOIN users u          ON u.id = c.user_id
                       LEFT JOIN subcontractors s ON s.id = c.subcontractor_id
                      WHERE c.task_id = t.id
                      GROUP BY COALESCE(u.name, s.name)) roster) AS crew
       FROM schedule_tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN subcontractors sub ON sub.id = t.subcontractor_id
      WHERE t.project_id = ANY($1::int[])
      ORDER BY p.name, t.position, t.id`,
    [projectIds]
  );
  if (rows.length === 0) return [];

  const holidays = await q<{ day: string }>('SELECT day FROM schedule_holidays');
  const calendar = { holidays: new Set(holidays.map((h) => h.day)) };
  const { windows } = computeSchedule(rows, calendar);
  const nameById = new Map(rows.map((r) => [r.id, r.name]));

  const out: BackupSchedulePhase[] = [];
  for (const r of rows) {
    const dates = windows.get(r.id);
    if (!dates) continue;
    out.push({
      project_id: r.project_id,
      project_name: r.project_name,
      phase: r.name,
      start_date: dates.start,
      end_date: dates.end,
      working_days: workingDaySpan(dates.start, dates.end, calendar),
      status: r.status,
      start_time: r.start_time ? timeLabel(r.start_time) : '',
      shift: shiftLabel({ startTime: r.start_time, hours: r.hours }),
      follows: (r.depends_on_id != null ? nameById.get(r.depends_on_id) : '') ?? '',
      subcontractor: r.subcontractor_name ?? '',
      crew_needed: r.crew_size,
      crew_days_booked: (r.crew ?? []).reduce((n, c) => n + c.days, 0),
      crew: (r.crew ?? [])
        .map((c) => `${c.name} (${c.days} ${c.days === 1 ? 'day' : 'days'})`)
        .join(', '),
      notes: r.notes,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ Users */

export interface UserRow {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'employee';
  active: number;
  created_at: string;
  // Optional email-resolution chain (personal_email -> work_email -> email).
  personal_email: string | null;
  work_email: string | null;
  // Per-user email subscription flags (one boolean column per email type).
  receives_new_project_emails: boolean;
  receives_completion_emails: boolean;
  // Reporting hierarchy: the user's manager (NULL = reports to no one).
  manager_id: number | null;
  manager_name: string | null;
  // Hourly pay rate (manager/admin-only surfaces). NULL = no rate set.
  hourly_rate: number | null;
  // Whether the crew week offers to book them. FALSE keeps an active user out
  // of scheduling entirely without touching their access or their time.
  schedulable: boolean;
}

/** Column names ↔ payload keys for the per-user subscription flags. */
export const USER_EMAIL_FLAGS = [
  'receives_new_project_emails',
  'receives_completion_emails',
] as const;
export type UserEmailFlag = (typeof USER_EMAIL_FLAGS)[number];

// NOTE: includes hourly_rate, so this select must only feed manager/admin-facing
// surfaces (the Settings -> Users listing). Never expose it to lower roles.
const USER_SELECT =
  `u.id, u.name, u.email, u.role, u.active, u.created_at,
   u.personal_email, u.work_email,
   u.receives_new_project_emails, u.receives_completion_emails,
   u.hourly_rate, u.schedulable,
   u.manager_id, m.name AS manager_name`;

export async function listUsers(): Promise<UserRow[]> {
  return q<UserRow>(
    `SELECT ${USER_SELECT}
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
      ORDER BY u.active DESC, u.name`
  );
}

/**
 * Active users. `schedulableOnly` narrows to the ones the crew week books —
 * everybody, until somebody is deliberately taken out of scheduling under
 * Settings -> Users. Payroll and timesheets want the whole list, so the filter
 * is asked for rather than assumed.
 */
export async function listActiveWorkers(
  opts: { schedulableOnly?: boolean } = {}
): Promise<UserRow[]> {
  return q<UserRow>(
    `SELECT ${USER_SELECT}
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
      WHERE u.active = 1 ${opts.schedulableOnly ? 'AND u.schedulable = TRUE' : ''}
      ORDER BY u.name`
  );
}

export async function emailExists(email: string): Promise<boolean> {
  const row = await one('SELECT 1 FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  return !!row;
}

export interface UserEmailFields {
  personal_email?: string | null;
  work_email?: string | null;
  receives_new_project_emails?: boolean;
  receives_completion_emails?: boolean;
}

export async function createUserRow(u: {
  name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'manager' | 'employee';
  manager_id?: number | null;
  hourly_rate?: number | null;
} & UserEmailFields): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO users
       (name, email, password_hash, role, personal_email, work_email,
        receives_new_project_emails, receives_completion_emails, manager_id, hourly_rate)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      u.name,
      u.email.trim().toLowerCase(),
      u.password_hash,
      u.role,
      u.personal_email?.trim() || null,
      u.work_email?.trim() || null,
      u.receives_new_project_emails ?? false,
      u.receives_completion_emails ?? false,
      u.manager_id ?? null,
      u.hourly_rate ?? null,
    ]
  );
  return row!.id;
}

/** Set (or clear, with null) a user's hourly pay rate. */
export async function setUserRate(userId: number, rate: number | null): Promise<void> {
  await q('UPDATE users SET hourly_rate = $1 WHERE id = $2', [rate, userId]);
}

/**
 * Put someone in or out of scheduling. Existing bookings are deliberately left
 * where they are: taking a person out of scheduling stops the crew week
 * offering them, it doesn't rewrite a schedule the crew may already have.
 */
export async function setUserSchedulable(userId: number, schedulable: boolean): Promise<void> {
  await q('UPDATE users SET schedulable = $1 WHERE id = $2', [schedulable, userId]);
}

/**
 * Update a user's email-resolution fields and subscription flags. The edit
 * form always submits every field, so these are assigned directly (allowing
 * an email field to be cleared).
 */
export async function updateUserEmailFields(id: number, fields: Required<UserEmailFields>): Promise<void> {
  await q(
    `UPDATE users
        SET personal_email = $1,
            work_email     = $2,
            receives_new_project_emails = $3,
            receives_completion_emails  = $4
      WHERE id = $5`,
    [
      fields.personal_email?.trim() || null,
      fields.work_email?.trim() || null,
      fields.receives_new_project_emails,
      fields.receives_completion_emails,
      id,
    ]
  );
}

export async function setUserRole(
  id: number,
  role: 'admin' | 'manager' | 'employee'
): Promise<void> {
  await q('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
}

export async function setUserActive(id: number, active: boolean): Promise<void> {
  await q('UPDATE users SET active = $1 WHERE id = $2', [active ? 1 : 0, id]);
  if (!active) {
    // end any open time entries and drop sessions for a deactivated user
    await q('UPDATE time_entries SET clock_out = now() WHERE user_id = $1 AND clock_out IS NULL', [id]);
    await q('DELETE FROM sessions WHERE user_id = $1', [id]);
  }
}

export async function setUserPassword(id: number, passwordHash: string): Promise<void> {
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
  await q('DELETE FROM sessions WHERE user_id = $1', [id]);
}

/**
 * Permanently delete a user. FK constraints cascade to the user's sessions,
 * time entries and password-reset tokens; notes and uploaded files keep their
 * text but have their user_id nulled out (the author/uploader name is stored
 * separately).
 */
export async function deleteUser(id: number): Promise<void> {
  await q('DELETE FROM users WHERE id = $1', [id]);
}

export async function countAdmins(): Promise<number> {
  return (await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1"
  ))!.n;
}

/** A user's display name, for showing who did something. */
export async function getUserName(id: number): Promise<string | null> {
  const row = await one<{ name: string }>('SELECT name FROM users WHERE id = $1', [id]);
  return row?.name ?? null;
}

export async function getUserRole(id: number): Promise<string | undefined> {
  const row = await one<{ role: string }>('SELECT role FROM users WHERE id = $1', [id]);
  return row?.role;
}

/* ----------------------------------------------------- Manager hierarchy */

/** Assign (or clear, with NULL) the manager a user reports to. */
export async function setUserManager(userId: number, managerId: number | null): Promise<void> {
  await q('UPDATE users SET manager_id = $1 WHERE id = $2', [managerId, userId]);
}

/** Active users who report directly to the given manager. */
export async function listDirectReports(managerId: number): Promise<UserRow[]> {
  return q<UserRow>(
    `SELECT ${USER_SELECT}
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
      WHERE u.manager_id = $1 AND u.active = 1
      ORDER BY u.name`,
    [managerId]
  );
}

/**
 * A user's role/active flag + manager pointer, for validating manager
 * assignments. Undefined when the user doesn't exist.
 */
export async function getUserManagerInfo(
  id: number
): Promise<{ role: string; active: number; manager_id: number | null } | undefined> {
  return one<{ role: string; active: number; manager_id: number | null }>(
    'SELECT role, active, manager_id FROM users WHERE id = $1',
    [id]
  );
}

/**
 * Walk up the manager chain starting AT startId (inclusive) and report whether
 * targetId appears in it — i.e. whether making targetId report to startId
 * would create a reporting cycle. Depth-capped so a pre-existing cycle in the
 * data can't loop forever.
 */
export async function managerChainContains(startId: number, targetId: number): Promise<boolean> {
  const row = await one(
    `WITH RECURSIVE chain AS (
       SELECT id, manager_id, 1 AS depth FROM users WHERE id = $1
       UNION ALL
       SELECT u.id, u.manager_id, c.depth + 1
         FROM users u
         JOIN chain c ON u.id = c.manager_id
        WHERE c.depth < 100
     )
     SELECT 1 FROM chain WHERE id = $2 LIMIT 1`,
    [startId, targetId]
  );
  return !!row;
}

/* ------------------------------------------------------------ Quote numbers */

/**
 * The first free quote number starting from `base` (`XXXMMDDYY`). Two quotes
 * raised for the same customer on the same day would otherwise collide, so the
 * second one becomes `XXXMMDDYY-2`, the third `-3`, and so on.
 *
 * `excludeId` is the quote being edited — its own number never counts as taken.
 */
export async function nextAvailableQuoteNumber(
  base: string,
  excludeId?: number
): Promise<string> {
  const taken = await q<{ quote_number: string }>(
    `SELECT quote_number FROM quotes
      WHERE quote_number IS NOT NULL
        AND upper(quote_number) LIKE upper($1) || '%'
        AND ($2::int IS NULL OR id <> $2)`,
    [base, excludeId ?? null]
  );
  const used = new Set(taken.map((r) => r.quote_number.trim().toUpperCase()));
  if (!used.has(base.toUpperCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate.toUpperCase())) return candidate;
  }
}

/* -------------------------------------------------------------- Customers */

export interface CustomerInput {
  name: string;
  /** Unique three-letter code, stored uppercase; null when not set. */
  abbreviation?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export async function listCustomers(): Promise<Customer[]> {
  return q<Customer>('SELECT * FROM customers ORDER BY name');
}

export async function getCustomer(id: number): Promise<Customer | undefined> {
  return one<Customer>('SELECT * FROM customers WHERE id = $1', [id]);
}

/** Every customer with its contacts, for the quote builder + settings editor. */
export async function listCustomersWithContacts(): Promise<CustomerWithContacts[]> {
  const customers = await listCustomers();
  if (customers.length === 0) return [];
  const contacts = await q<CustomerContact>(
    'SELECT * FROM customer_contacts ORDER BY name'
  );
  const byCustomer = new Map<number, CustomerContact[]>();
  for (const c of contacts) {
    const list = byCustomer.get(c.customer_id) ?? [];
    list.push(c);
    byCustomer.set(c.customer_id, list);
  }
  return customers.map((cust) => ({ ...cust, contacts: byCustomer.get(cust.id) ?? [] }));
}

export async function createCustomer(input: CustomerInput): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO customers (name, abbreviation, address, phone, email, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      input.name,
      input.abbreviation ?? null,
      input.address ?? null,
      input.phone ?? null,
      input.email ?? null,
      input.notes ?? null,
    ]
  );
  return row!.id;
}

export async function updateCustomer(id: number, input: CustomerInput): Promise<void> {
  await q(
    `UPDATE customers
        SET name = $1, abbreviation = $2, address = $3, phone = $4, email = $5,
            notes = $6, updated_at = now()
      WHERE id = $7`,
    [
      input.name,
      input.abbreviation ?? null,
      input.address ?? null,
      input.phone ?? null,
      input.email ?? null,
      input.notes ?? null,
      id,
    ]
  );
}

export async function deleteCustomer(id: number): Promise<void> {
  await q('DELETE FROM customers WHERE id = $1', [id]);
}

/* ------------------------------------------------------- Customer contacts */

export interface ContactInput {
  customer_id: number;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
}

export async function createContact(input: ContactInput): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO customer_contacts (customer_id, name, title, email, phone)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [input.customer_id, input.name, input.title ?? null, input.email ?? null, input.phone ?? null]
  );
  return row!.id;
}

export async function getContact(id: number): Promise<CustomerContact | undefined> {
  return one<CustomerContact>('SELECT * FROM customer_contacts WHERE id = $1', [id]);
}

export async function updateContact(
  id: number,
  input: Omit<ContactInput, 'customer_id'>
): Promise<void> {
  await q(
    `UPDATE customer_contacts SET name = $1, title = $2, email = $3, phone = $4 WHERE id = $5`,
    [input.name, input.title ?? null, input.email ?? null, input.phone ?? null, id]
  );
}

export async function deleteContact(id: number): Promise<void> {
  await q('DELETE FROM customer_contacts WHERE id = $1', [id]);
}

/* --------------------------------------------------------- Pricing items */

export interface PricingItemInput {
  description: string;
  unit?: string | null;
  unit_price: number;
  category?: string | null;
}

export async function listPricingItems(): Promise<PricingItem[]> {
  return q<PricingItem>('SELECT * FROM pricing_items ORDER BY category NULLS FIRST, description');
}

export async function getPricingItem(id: number): Promise<PricingItem | undefined> {
  return one<PricingItem>('SELECT * FROM pricing_items WHERE id = $1', [id]);
}

export async function createPricingItem(input: PricingItemInput): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO pricing_items (description, unit, unit_price, category)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [input.description, input.unit ?? null, input.unit_price, input.category ?? null]
  );
  return row!.id;
}

export async function updatePricingItem(id: number, input: PricingItemInput): Promise<void> {
  await q(
    `UPDATE pricing_items
        SET description = $1, unit = $2, unit_price = $3, category = $4, updated_at = now()
      WHERE id = $5`,
    [input.description, input.unit ?? null, input.unit_price, input.category ?? null, id]
  );
}

export async function deletePricingItem(id: number): Promise<void> {
  await q('DELETE FROM pricing_items WHERE id = $1', [id]);
}

/* ------------------------------------------------------------------ Units */

export async function listUnits(): Promise<Unit[]> {
  return q<Unit>('SELECT * FROM units ORDER BY position, lower(label)');
}

/**
 * Add a unit of measure. Idempotent by (case-insensitive) label: if it already
 * exists the existing row is returned rather than erroring, so quick-adds from
 * the quote view never fail on a duplicate. New units sort after the defaults.
 */
export async function createUnit(label: string): Promise<Unit> {
  const clean = label.trim();
  const existing = await one<Unit>('SELECT * FROM units WHERE lower(label) = lower($1)', [clean]);
  if (existing) return existing;
  const row = await one<Unit>(
    `INSERT INTO units (label, position)
     VALUES ($1, COALESCE((SELECT MAX(position) FROM units), 0) + 1)
     RETURNING *`,
    [clean]
  );
  return row!;
}

/* ------------------------------------------------------------- Categories */

export async function listCategories(): Promise<Category[]> {
  return q<Category>('SELECT * FROM categories ORDER BY position, lower(name)');
}

/**
 * Add a quote/work category. Idempotent by (case-insensitive) name, mirroring
 * createUnit, so quick-adds from the quote builder never fail on a duplicate.
 */
export async function createCategory(name: string): Promise<Category> {
  const clean = name.trim();
  const existing = await one<Category>('SELECT * FROM categories WHERE lower(name) = lower($1)', [clean]);
  if (existing) return existing;
  const row = await one<Category>(
    `INSERT INTO categories (name, position)
     VALUES ($1, COALESCE((SELECT MAX(position) FROM categories), 0) + 1)
     RETURNING *`,
    [clean]
  );
  return row!;
}
