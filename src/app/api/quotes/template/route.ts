import * as XLSX from 'xlsx';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  // Each row is one line item. Rows that share a Quote Number roll up into a
  // single quote — repeat the header fields on the first row of each quote and
  // leave them blank on the continuation rows. "Item Type" is either
  // "Line Item" (customer-facing, shown on the PDF, uses Amount) or "Pricing"
  // (internal cost worksheet, uses Qty × Unit Price and is never shown to the
  // customer). Blank Item Type defaults to Line Item.
  const rows = [
    {
      'Quote Number': 'Q-1042',
      Customer: 'ARH-Highlands',
      Project: 'Corridor Flooring Replacement',
      Category: 'Flooring',
      'Date Received': '2026-07-13',
      Notes: 'Awaiting board approval',
      'Tax Rate %': 0,
      'Markup %': 0,
      'Item Type': 'Line Item',
      'Item Description': 'Furnish and install carpet tile — Corridor A',
      Qty: 1,
      Unit: 'ls',
      'Unit Price': 98500,
      Amount: 98500,
    },
    {
      'Quote Number': 'Q-1042',
      Customer: '',
      Project: '',
      Category: '',
      'Date Received': '',
      Notes: '',
      'Tax Rate %': '',
      'Markup %': '',
      'Item Type': 'Line Item',
      'Item Description': 'Furnish and install LVT — Corridor B',
      Qty: 1,
      Unit: 'ls',
      'Unit Price': 88721,
      Amount: 88721,
    },
    {
      'Quote Number': 'Q-1042',
      Customer: '',
      Project: '',
      Category: '',
      'Date Received': '',
      Notes: '',
      'Tax Rate %': '',
      'Markup %': '',
      'Item Type': 'Pricing',
      'Item Description': 'Carpet tile',
      Qty: 3200,
      Unit: 'sf',
      'Unit Price': 3.25,
      Amount: '',
    },
    {
      'Quote Number': 'Q-1042',
      Customer: '',
      Project: '',
      Category: '',
      'Date Received': '',
      Notes: '',
      'Tax Rate %': '',
      'Markup %': '',
      'Item Type': 'Pricing',
      'Item Description': 'Installation labor',
      Qty: 240,
      Unit: 'hr',
      'Unit Price': 65,
      Amount: '',
    },
    {
      'Quote Number': 'Q-1043',
      Customer: 'Georgetown CH',
      Project: 'Interior Repaint',
      Category: 'Painting',
      'Date Received': '2026-07-14',
      Notes: '',
      'Tax Rate %': 0,
      'Markup %': 0,
      'Item Type': 'Line Item',
      'Item Description': 'Repaint all resident rooms — two coats',
      Qty: 1,
      Unit: 'ls',
      'Unit Price': 72000,
      Amount: 72000,
    },
    {
      'Quote Number': 'Q-1043',
      Customer: '',
      Project: '',
      Category: '',
      'Date Received': '',
      Notes: '',
      'Tax Rate %': '',
      'Markup %': '',
      'Item Type': 'Line Item',
      'Item Description': 'Repaint common areas & corridors',
      Qty: 1,
      Unit: 'ls',
      'Unit Price': 35531,
      Amount: 35531,
    },
  ];

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 }, // Quote Number
    { wch: 20 }, // Customer
    { wch: 32 }, // Project
    { wch: 14 }, // Category
    { wch: 14 }, // Date Received
    { wch: 26 }, // Notes
    { wch: 10 }, // Tax Rate %
    { wch: 10 }, // Markup %
    { wch: 12 }, // Item Type
    { wch: 44 }, // Item Description
    { wch: 8 }, // Qty
    { wch: 8 }, // Unit
    { wch: 12 }, // Unit Price
    { wch: 12 }, // Amount
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'New Quotes');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="cornerstone-quotes-template.xlsx"',
    },
  });
}
