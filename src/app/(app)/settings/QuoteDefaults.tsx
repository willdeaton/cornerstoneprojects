'use client';

import { useEffect, useState } from 'react';

/**
 * Default Terms & Conditions pre-filled on every new quote. Stored alongside
 * the company profile in the singleton company_settings row, edited here and
 * read by the New Quote builder.
 */
export function QuoteDefaults() {
  const [terms, setTerms] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/company-settings');
        if (!res.ok) throw new Error('Could not load quote defaults.');
        const data = await res.json();
        setTerms(data.settings?.default_terms ?? '');
      } catch (e) {
        setMsg({ kind: 'err', text: (e as Error).message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/company-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_terms: terms }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed.');
      setTerms(data.settings?.default_terms ?? '');
      setMsg({ kind: 'ok', text: 'Default terms saved. They now pre-fill new quotes.' });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-brand-gray">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Terms &amp; Conditions</label>
        <textarea
          className="input min-h-[140px] resize-y"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          placeholder={'Payment due within 30 days of invoice.\nPricing valid for 30 days from the issue date.\nWork to be performed during normal business hours.'}
        />
        <p className="mt-1 text-xs text-brand-gray">
          Pre-filled into the Terms &amp; Conditions field on every new quote. You can still edit or clear
          them on an individual quote before sending. Existing quotes are unaffected.
        </p>
      </div>

      {msg && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            msg.kind === 'ok'
              ? 'bg-brand-green/15 text-brand-green-dark'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
