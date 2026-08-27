'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * Screen-only controls above the timesheet: back to the review table, the
 * browser's own print, and a PDF for emailing to payroll. Mirrors the quote
 * print toolbar — same html2pdf setup, so both documents come out of the same
 * pipeline at letter size.
 */
export function PrintToolbar({ backHref, fileName }: { backHref: string; fileName: string }) {
  const [downloading, setDownloading] = useState(false);

  async function downloadPdf() {
    const el = document.getElementById('timesheet-document');
    if (!el) return;
    setDownloading(true);
    try {
      // Loaded lazily and client-side only — html2pdf touches window/document.
      const html2pdf = (await import('html2pdf.js')).default;
      await html2pdf()
        .set({
          margin: 0,
          filename: `${fileName}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] },
        })
        .from(el)
        .save();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-black/10 bg-white px-4 py-3">
      <Link href={backHref} className="btn-secondary">
        ← Back to Timesheets
      </Link>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary" onClick={() => window.print()}>
          Print
        </button>
        <button type="button" className="btn-primary" onClick={downloadPdf} disabled={downloading}>
          {downloading ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>
    </div>
  );
}
