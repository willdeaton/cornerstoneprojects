import * as XLSX from 'xlsx';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const rows = [
    {
      'Quote Number': 'Q-1042',
      Customer: 'ARH-Highlands',
      Project: 'Corridor Flooring Replacement',
      Category: 'Flooring',
      'Bid Value': 187221,
      'Date Received': '2026-07-13',
      Notes: 'Awaiting board approval',
    },
    {
      'Quote Number': 'Q-1043',
      Customer: 'Georgetown CH',
      Project: 'Interior Repaint',
      Category: 'Painting',
      'Bid Value': 107531,
      'Date Received': '2026-07-14',
      Notes: '',
    },
    {
      'Quote Number': '',
      Customer: 'Example Client',
      Project: 'Scope of work',
      Category: 'Renovation',
      'Bid Value': 25000,
      'Date Received': '',
      Notes: '',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 36 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 32 }];
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
