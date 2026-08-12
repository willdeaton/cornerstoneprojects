'use client';

import { useState, useTransition } from 'react';
import { sendApprovalEmailsNowAction } from '@/app/actions/approve-time';

/** Admin-only manual trigger for the Monday weekly-approval emails. */
export function SendApprovalEmails() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function send() {
    setMsg(null);
    start(async () => {
      const res = await sendApprovalEmailsNowAction();
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error ?? 'Send failed.' });
        return;
      }
      const r = res.result!;
      if (r.status === 'skipped') {
        setMsg({ kind: 'ok', text: `Skipped: ${r.reason ?? 'nothing to send.'}` });
      } else {
        setMsg({
          kind: 'ok',
          text: `Sent ${r.count} of ${r.attempted} approval email${r.attempted === 1 ? '' : 's'} for the week of ${res.weekStart}.`,
        });
      }
    });
  }

  return (
    <div className="space-y-3">
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
      <button className="btn-primary" onClick={send} disabled={pending}>
        {pending ? 'Sending…' : 'Send approval emails now'}
      </button>
    </div>
  );
}
