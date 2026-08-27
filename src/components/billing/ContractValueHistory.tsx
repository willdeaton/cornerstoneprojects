import { money, dateTime } from '@/lib/format';
import type { ProjectValueChange } from '@/lib/types';

/**
 * The badge says "CO" already, so a number typed as "CO-777" would read back as
 * "CO CO-777". Strip the prefix people naturally include.
 */
function coLabel(coNumber: string): string {
  return coNumber.replace(/^\s*C\.?O\.?[\s#:-]*/i, '').trim() || coNumber.trim();
}

/**
 * Every move of one job's contract value, newest first.
 *
 * Presentational and hook-free on purpose: the Billing tab renders it as a
 * server component, and the change dialog imports the same one so a change you
 * have just recorded appears in the same list you read before making it.
 *
 * Rows carry where they came from. A change order somebody sat down and
 * recorded and a revision pushed through from a quote edited after the job
 * sold are not the same event, and a fortnight later that difference is the
 * whole story — so the second kind says so on its face.
 */
export function ContractValueHistory({ changes }: { changes: ProjectValueChange[] }) {
  if (changes.length === 0) {
    return (
      <p className="text-sm text-brand-gray">
        The contract value hasn&apos;t moved since this job was sold. Every change to it is
        recorded here with the reason it was given — including the ones pushed through from a
        quote revised after the sale.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-black/5">
      {changes.map((c) => {
        const delta = c.new_value - c.old_value;
        const up = delta > 0;
        return (
          <li key={c.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tnum text-sm text-brand-gray">
                {money(c.old_value, { cents: true })} →{' '}
                <strong className="text-brand-ink">{money(c.new_value, { cents: true })}</strong>
              </span>
              <span
                className={`badge tnum ${
                  up ? 'bg-brand-green/15 text-brand-green-dark' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {up ? '+' : '−'}
                {money(Math.abs(delta), { cents: true })}
              </span>
              {c.co_number && (
                <span className="badge bg-blue-100 text-blue-800">CO {coLabel(c.co_number)}</span>
              )}
              {c.source === 'quote' && (
                <span
                  className="badge bg-brand-ink/10 text-brand-ink"
                  title="Pushed through from a quote revised after this job was sold"
                >
                  From quote
                </span>
              )}
            </div>
            <p className="mt-1 text-sm font-medium text-brand-ink">{c.reason}</p>
            <p className="mt-0.5 text-xs text-brand-gray">
              {dateTime(c.created_at)}
              {c.changed_by_name ? ` · ${c.changed_by_name}` : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
