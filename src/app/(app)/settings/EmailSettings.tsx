'use client';

import { useEffect, useState } from 'react';

const SECRET_MASK = '••••••••';

interface Settings {
  from_name: string;
  from_email: string;
  smtp_password: string; // masked from the server
}

export function EmailSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // GET on open.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/email-settings');
        if (!res.ok) throw new Error('Could not load settings.');
        const data = await res.json();
        setSettings({
          from_name: data.settings.from_name ?? '',
          from_email: data.settings.from_email ?? '',
          smtp_password: data.settings.smtp_password ?? '',
        });
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
      const res = await fetch('/api/email-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed.');
      setSettings({
        from_name: data.settings.from_name ?? '',
        from_email: data.settings.from_email ?? '',
        smtp_password: data.settings.smtp_password ?? '',
      });
      setMsg({ kind: 'ok', text: 'Email settings saved.' });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/test-email', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Test failed.');
      setMsg({ kind: 'ok', text: 'Test email sent to the configured from address.' });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <p className="text-sm text-brand-gray">Loading…</p>;
  if (!settings) return <p className="text-sm text-red-700">{msg?.text ?? 'Unavailable.'}</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">From Name</label>
          <input
            className="input"
            value={settings.from_name}
            onChange={(e) => update('from_name', e.target.value)}
            placeholder="Cornerstone Facility Solutions"
          />
        </div>
        <div>
          <label className="label">From Email</label>
          <input
            className="input"
            type="email"
            value={settings.from_email}
            onChange={(e) => update('from_email', e.target.value)}
            placeholder="noreply@dlomgroup.com"
          />
        </div>
      </div>

      <p className="text-xs text-brand-gray">
        The from address must be a sender authenticated with your email provider.
        The provider API key is read from the <code>SENDGRID_API_KEY</code>{' '}
        environment variable and is never stored here.
      </p>

      {/* Legacy secret field — masked, only overwritten when you type a real value. */}
      <div>
        <label className="label">Legacy SMTP password (unused)</label>
        <input
          className="input"
          type="password"
          value={settings.smtp_password}
          onChange={(e) => update('smtp_password', e.target.value)}
          placeholder={SECRET_MASK}
        />
        <p className="mt-1 text-xs text-brand-gray">
          Retained for backwards-compatibility; not used for delivery. Leave the
          mask in place to keep the stored value.
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
        <button className="btn-secondary" onClick={sendTest} disabled={testing}>
          {testing ? 'Sending…' : 'Send test email'}
        </button>
      </div>
    </div>
  );
}
