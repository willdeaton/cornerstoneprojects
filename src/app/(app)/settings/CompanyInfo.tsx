'use client';

import { useEffect, useState } from 'react';

interface Settings {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
}

const EMPTY: Settings = { name: '', address: '', phone: '', email: '', website: '' };

export function CompanyInfo() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // GET on open.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/company-settings');
        if (!res.ok) throw new Error('Could not load company info.');
        const data = await res.json();
        setSettings({ ...EMPTY, ...data.settings });
      } catch (e) {
        setMsg({ kind: 'err', text: (e as Error).message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/company-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed.');
      setSettings({ ...EMPTY, ...data.settings });
      setMsg({ kind: 'ok', text: 'Company info saved. It now appears on new quote PDFs.' });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-brand-gray">Loading…</p>;
  if (!settings) return <p className="text-sm text-red-700">{msg?.text ?? 'Unavailable.'}</p>;

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Company Name</label>
        <input
          className="input"
          value={settings.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="Cornerstone Facility Solutions"
        />
      </div>

      <div>
        <label className="label">Address</label>
        <textarea
          className="input min-h-[88px] resize-y"
          value={settings.address}
          onChange={(e) => update('address', e.target.value)}
          placeholder={'123 Main Street\nSuite 100\nYour City, ST 00000'}
        />
        <p className="mt-1 text-xs text-brand-gray">One line per row — shown under the name on the quote.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Phone</label>
          <input
            className="input"
            value={settings.phone}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="(555) 555-0100"
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={settings.email}
            onChange={(e) => update('email', e.target.value)}
            placeholder="estimating@cornerstonefs.com"
          />
        </div>
        <div>
          <label className="label">Website</label>
          <input
            className="input"
            value={settings.website}
            onChange={(e) => update('website', e.target.value)}
            placeholder="cornerstonefs.com"
          />
        </div>
      </div>

      <p className="text-xs text-brand-gray">
        The logo on quotes comes from <code>public/branding/logo.png</code> — replace that file to
        change it.
      </p>

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
