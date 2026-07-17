import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';

const COLUMN_HINTS: Record<string, string[]> = {
  quote_number: ['quote number', 'quote #', 'quote no', 'proposal number', 'proposal #', 'proposal no', 'number', 'quote id', 'ref'],
  customer: ['customer', 'client', 'account', 'company', 'name of customer'],
  project_name: ['project', 'description', 'scope', 'job', 'work', 'proposal'],
  category: ['category', 'type', 'trade', 'division', 'service'],
  bid_value: ['bid', 'value', 'amount', 'total', 'price', 'quote', 'contract', 'estimate'],
  date_received: ['date received', 'received', 'date', 'submitted', 'week of', 'quoted'],
  notes: ['notes', 'note', 'comment', 'remarks', 'detail'],
};

// Fields checked first so a generic hint (e.g. "quote", "date") doesn't get
// claimed by a broader field before its specific column is matched.
const DETECT_ORDER = ['quote_number', 'date_received', 'customer', 'category', 'bid_value', 'project_name', 'notes'];

function detect(headers: string[]): Record<string, string | null> {
  const map: Record<string, string | null> = {
    quote_number: null,
    customer: null,
    project_name: null,
    category: null,
    bid_value: null,
    date_received: null,
    notes: null,
  };
  const lc = headers.map((h) => h.toLowerCase().trim());
  const taken = new Set<number>();
  for (const field of DETECT_ORDER) {
    for (const hint of COLUMN_HINTS[field]) {
      const idx = lc.findIndex((h, i) => !taken.has(i) && h.includes(hint));
      if (idx !== -1) {
        map[field] = headers[idx];
        taken.add(idx);
        break;
      }
    }
  }
  return map;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Coerce a cell into an ISO date string (YYYY-MM-DD), or null if unusable. */
function toDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  // xlsx returns real Date objects when cellDates is on.
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: 'The file has no sheets.' }, { status: 400 });

    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    if (json.length === 0) {
      return NextResponse.json({ error: 'No rows found in the first sheet.' }, { status: 400 });
    }

    const headers = Object.keys(json[0]);
    const map = detect(headers);

    if (!map.customer && !map.bid_value) {
      return NextResponse.json(
        {
          error:
            'Could not find a Customer or Bid Value column. Use the template, or make sure your headers include a customer and an amount.',
          headers,
        },
        { status: 422 }
      );
    }

    const rows = json
      .map((r) => ({
        quote_number: map.quote_number ? String(r[map.quote_number] ?? '').trim() || null : null,
        customer: map.customer ? String(r[map.customer] ?? '').trim() : '',
        project_name: map.project_name ? String(r[map.project_name] ?? '').trim() || null : null,
        category: map.category ? String(r[map.category] ?? '').trim() || null : null,
        bid_value: map.bid_value ? toNumber(r[map.bid_value]) : 0,
        date_received: map.date_received ? toDate(r[map.date_received]) : null,
        notes: map.notes ? String(r[map.notes] ?? '').trim() || null : null,
      }))
      .filter((r) => r.customer || r.bid_value);

    return NextResponse.json({ rows, mapping: map, headers, count: rows.length });
  } catch (err) {
    console.error('parse error', err);
    return NextResponse.json(
      { error: 'Could not read that file. Make sure it is a valid .xlsx or .csv.' },
      { status: 400 }
    );
  }
}
