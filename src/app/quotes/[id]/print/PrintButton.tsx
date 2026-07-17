'use client';

import Link from 'next/link';

export function PrintToolbar({ editHref }: { editHref: string }) {
  return (
    <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-black/10 bg-white px-4 py-3">
      <Link href="/quotes" className="btn-secondary">
        ← Back to Quotes
      </Link>
      <div className="flex gap-2">
        <Link href={editHref} className="btn-secondary">
          Edit
        </Link>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Download PDF
        </button>
      </div>
    </div>
  );
}
