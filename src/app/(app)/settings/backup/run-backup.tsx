/**
 * Shared backup routine used by both the Settings → Backup panel and the
 * monthly BackupReminder popup. Fetches the date-range data, builds a
 * multi-sheet workbook, renders every quote to PDF, gathers project files and
 * packages the lot into a ZIP that downloads in the browser.
 *
 * Everything runs client-side, so this lives in a `.tsx` client module (it
 * renders <QuoteDocument/>) and is imported by the panel and the reminder.
 */
import { QuoteDocument } from '@/app/quotes/[id]/print/QuoteDocument';
import { richTextToPlain } from '@/lib/richtext';
import type { BackupPayload } from '@/lib/backup-types';
import {
  billingSummary,
  BILLING_STAGE_LABELS,
  EMPTY_TALLY,
  type InvoiceTally,
} from '@/lib/billing';

/** ISO date (YYYY-MM-DD) in the browser's local time. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** Make a string safe to use as a file name inside the zip. */
function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'file';
}

/** Resolve once every <img> in the node has loaded (or errored) so html2canvas
 *  captures the logo rather than a blank box. */
function waitForImages(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll('img'));
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          })
    )
  ).then(() => undefined);
}

/** Build the multi-sheet workbook and return it as an ArrayBuffer. The `xlsx`
 *  module is passed in so it can be lazily imported at download time rather
 *  than bundled into the page's initial load. */
function buildWorkbook(data: BackupPayload, XLSX: typeof import('xlsx')): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const addSheet = (name: string, rows: Record<string, unknown>[]) => {
    // json_to_sheet on an empty array yields an empty sheet, which is fine —
    // the tab still documents that the section had no rows in this range.
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  addSheet(
    'Quotes',
    data.quotes.map((q) => ({
      'Quote Number': q.quote_number ?? '',
      Customer: q.customer,
      Project: q.project_name ?? '',
      Category: q.category ?? '',
      Status: q.status,
      'Bid Value': q.bid_value,
      'Date Received': q.date_received ?? '',
      'Issue Date': q.issue_date ?? '',
      'Valid Until': q.valid_until ?? '',
      'Tax Rate %': (q.tax_rate || 0) * 100,
      'Markup %': (q.markup_rate || 0) * 100,
      'Prepared By': q.prepared_by ?? '',
      Notes: q.notes ?? '',
      Created: q.created_at,
    }))
  );

  addSheet(
    'Quote Line Items',
    data.quotes.flatMap((q) =>
      q.line_items.map((li) => ({
        'Quote Number': q.quote_number ?? String(q.id),
        Kind: li.kind,
        // Which pricing option the line belongs to, blank for base lines.
        Option: li.option_group ?? '',
        Description: richTextToPlain(li.description),
        Qty: li.quantity,
        Unit: li.unit ?? '',
        'Unit Price': li.unit_price,
        Amount: li.amount ?? '',
        'Markup %': (li.markup_rate || 0) * 100,
        'Cost Type': li.cost_type ?? '',
      }))
    )
  );

  // The billing stage is derived, so the backup works it out the same way the
  // app does rather than reading a column that doesn't exist.
  const talliesByProject = new Map<number, InvoiceTally>();
  for (const inv of data.invoices) {
    const t = talliesByProject.get(inv.project_id) ?? { ...EMPTY_TALLY };
    const sent = inv.billed || inv.paid;
    talliesByProject.set(inv.project_id, {
      count: t.count + 1,
      billedCount: t.billedCount + (sent ? 1 : 0),
      paidCount: t.paidCount + (inv.paid ? 1 : 0),
      invoiced: t.invoiced + inv.amount,
      billed: t.billed + (sent ? inv.amount : 0),
      paid: t.paid + (inv.paid ? inv.amount : 0),
    });
  }

  addSheet(
    'Projects',
    data.projects.map((p) => {
      const billing = billingSummary(p, talliesByProject.get(p.id) ?? EMPTY_TALLY);
      return {
        Name: p.name,
        Customer: p.customer,
        'Quote Number': p.quote_number ?? '',
        Category: p.category ?? '',
        Value: p.value,
        Status: p.status,
        'Progress %': p.progress,
        Location: p.location ?? '',
        'Start Date': p.start_date ?? '',
        'End Date': p.end_date ?? '',
        'Due Date': p.due_date ?? '',
        Completed: p.completed_at ?? '',
        'Billing Stage': BILLING_STAGE_LABELS[billing.stage],
        Invoiced: billing.invoiced,
        Paid: billing.paid,
        Outstanding: billing.outstanding,
        'Billing Hold': p.billing_hold ? p.billing_hold_reason || 'Yes' : '',
        'Billing Closed': p.billing_closed_at ?? '',
        Created: p.created_at,
      };
    })
  );

  const projectName = new Map(data.projects.map((p) => [p.id, p.name]));

  addSheet(
    'Invoices',
    data.invoices.map((inv) => ({
      Project: projectName.get(inv.project_id) ?? `#${inv.project_id}`,
      'Invoice #': inv.invoice_number ?? '',
      Amount: inv.amount,
      Billed: inv.billed ? 'Yes' : 'No',
      Paid: inv.paid ? 'Yes' : 'No',
      Created: inv.created_at,
    }))
  );

  addSheet(
    'Project Notes',
    data.notes.map((n) => ({
      Project: projectName.get(n.project_id) ?? `#${n.project_id}`,
      Author: n.author_name,
      Note: n.body,
      Created: n.created_at,
    }))
  );

  addSheet(
    'Time Entries',
    data.timeEntries.map((t) => ({
      Employee: t.user_name,
      Project: t.project_name ?? '',
      Customer: t.customer ?? '',
      'Clock In': t.clock_in,
      'Clock Out': t.clock_out ?? '',
      'Break (min)': t.break_minutes,
      'Net Hours': Math.round(t.net_hours * 100) / 100,
      Paid: t.paid ? 'Yes' : 'No',
      Note: t.note ?? '',
    }))
  );

  addSheet(
    'Customers',
    data.customers.map((c) => ({
      Name: c.name,
      Address: c.address ?? '',
      Phone: c.phone ?? '',
      Email: c.email ?? '',
      Contacts: c.contacts
        .map((ct) => [ct.name, ct.title, ct.email, ct.phone].filter(Boolean).join(' / '))
        .join('; '),
      Notes: c.notes ?? '',
    }))
  );

  addSheet(
    'Pricing',
    data.pricing.map((p) => ({
      Description: p.description,
      Unit: p.unit ?? '',
      'Unit Price': p.unit_price,
      Category: p.category ?? '',
    }))
  );

  addSheet(
    'Schedule',
    data.schedule.map((s) => ({
      Project: s.project_name,
      Phase: s.phase,
      Start: s.start_date,
      End: s.end_date,
      'Daily Start Time': s.start_time,
      'Working Days': s.working_days,
      Status: s.status,
      Follows: s.follows,
      Subcontractor: s.subcontractor,
      'Crew Needed / Day': s.crew_needed,
      'Crew Days Booked': s.crew_days_booked,
      Crew: s.crew,
      Notes: s.notes ?? '',
    }))
  );

  addSheet(
    'Subcontractors',
    data.subcontractors.map((s) => ({
      Name: s.name,
      Trade: s.trade ?? '',
      Contact: s.contact_name ?? '',
      Email: s.email ?? '',
      Phone: s.phone ?? '',
      Active: s.active ? 'Yes' : 'No',
      Notes: s.notes ?? '',
    }))
  );

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/**
 * Fetch, build and download a backup ZIP for the `[from, to]` date range.
 * `onProgress` receives human-readable status updates; the returned string is a
 * short summary of what was included. Throws on any failure.
 */
export async function runBackup(
  from: string,
  to: string,
  onProgress: (message: string) => void = () => {}
): Promise<string> {
  onProgress('Gathering data…');
  const res = await fetch(`/api/backup?from=${from}&to=${to}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Export failed (${res.status}).`);
  }
  const data: BackupPayload = await res.json();

  // Heavy libraries loaded on demand (not in the page's initial bundle).
  const XLSX = await import('xlsx');
  const JSZip = (await import('jszip')).default;

  const zip = new JSZip();
  zip.file('data.xlsx', buildWorkbook(data, XLSX));

  // Render each quote to PDF client-side, reusing the exact print layout.
  if (data.quotes.length > 0) {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html2pdf = (await import('html2pdf.js')).default;

    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:8.5in;background:#ffffff;';
    document.body.appendChild(holder);
    const quotesFolder = zip.folder('quotes')!;
    // Guarantee unique names: quote numbers can repeat (or be blank), which
    // would otherwise overwrite an earlier quote's PDF inside the zip.
    const usedNames = new Set<string>();
    try {
      for (let i = 0; i < data.quotes.length; i++) {
        const q = data.quotes[i];
        onProgress(`Rendering quote PDFs… (${i + 1} of ${data.quotes.length})`);
        holder.innerHTML = renderToStaticMarkup(
          <QuoteDocument quote={q} company={data.company} />
        );
        const el = holder.firstElementChild as HTMLElement;
        await waitForImages(el);
        const blob = await html2pdf()
          .set({
            margin: 0,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] },
          })
          .from(el)
          .outputPdf('blob');
        const base = `Quote-${safeName(String(q.quote_number || q.id))}`;
        const name = usedNames.has(base) ? `${base}-${q.id}` : base;
        usedNames.add(name);
        quotesFolder.file(`${name}.pdf`, blob);
      }
    } finally {
      document.body.removeChild(holder);
    }
  }

  // Attached project files (fetched individually so the JSON stays small).
  if (data.projectFiles.length > 0) {
    const filesFolder = zip.folder('project-files')!;
    for (let i = 0; i < data.projectFiles.length; i++) {
      const f = data.projectFiles[i];
      onProgress(`Adding project files… (${i + 1} of ${data.projectFiles.length})`);
      const fileRes = await fetch(`/api/files/${f.id}?download=1`);
      if (!fileRes.ok) continue; // skip a file that can't be read rather than failing the whole backup
      const blob = await fileRes.blob();
      filesFolder.file(`${f.project_id}-${f.id}-${safeName(f.filename)}`, blob);
    }
  }

  onProgress('Packaging ZIP…');
  const out = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(out);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cornerstone-backup_${from}_to_${to}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return (
    `Backup ready — ${data.quotes.length} quote${data.quotes.length === 1 ? '' : 's'}, ` +
    `${data.projects.length} project${data.projects.length === 1 ? '' : 's'}, ` +
    `${data.timeEntries.length} time entr${data.timeEntries.length === 1 ? 'y' : 'ies'}.`
  );
}
