import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';

const COLUMN_HINTS: Record<string, string[]> = {
  customer: ['customer', 'client', 'account', 'company', 'name of customer'],
  project_name: ['project', 'description', 'scope', 'job', 'work', 'proposal'],
  category: ['category', 'type', 'trade', 'division', 'service'],
  bid_value: ['bid', 'value', 'amount', 'total', 'price', 'quote', 'contract', 'estimate'],
};

function detect(headers: string[]): Record<string, string | null> {
  const map: Record<string, string | null> = {
    customer: null,
    project_name: null,
    category: null,
    bid_value: null,
  };
  const lc = headers.map((h) => h.toLowerCase().trim());
  for (const field of Object.keys(COLUMN_HINTS)) {
    for (const hint of COLUMN_HINTS[field]) {
      const idx = lc.findIndex((h) => h.includes(hint));
      if (idx !== -1) {
        map[field] = headers[idx];
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
    const wb = XLSX.read(buf, { type: 'buffer' });
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
        customer: map.customer ? String(r[map.customer] ?? '').trim() : '',
        project_name: map.project_name ? String(r[map.project_name] ?? '').trim() || null : null,
        category: map.category ? String(r[map.category] ?? '').trim() || null : null,
        bid_value: map.bid_value ? toNumber(r[map.bid_value]) : 0,
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
