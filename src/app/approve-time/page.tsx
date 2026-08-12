import { getBranding } from '@/lib/branding-store';
import { validateApprovalToken } from '@/lib/time-approval-tokens';
import { managerWeekSummary, type ReportWeekSummary } from '@/lib/data';
import { shortDate } from '@/lib/format';
import { approveFromEmailAction, approveAllFromEmailAction } from '@/app/actions/approve-time';

/*
 * PUBLIC approve-from-email page (outside the (app) group, like
 * /reset-password): no login — the token in the link is the credential.
 * GET only RENDERS; approvals happen via the form posts to the server
 * actions, which re-validate the token before writing anything.
 */

export const dynamic = 'force-dynamic';

function weekLabel(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start.getTime() + 6 * 864e5);
  return `${shortDate(weekStart)} – ${shortDate(end.toISOString().slice(0, 10))}`;
}

function dayHeader(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getMonth() + 1}/${d.getDate()}`;
}

function ReportCard({ report, token }: { report: ReportWeekSummary; token: string }) {
  return (
    <div className="rounded-xl border border-black/5 bg-black/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-brand-ink">{report.user_name}</p>
          <p className="text-xs text-brand-gray">
            {report.total_hours > 0
              ? `${report.total_hours.toFixed(1)} hours this week`
              : 'No time recorded'}
          </p>
        </div>
        {report.approved ? (
          <span className="rounded-full bg-brand-green/20 px-3 py-1 text-xs font-semibold text-brand-green-dark">
            Approved
            {report.approved_by_name ? ` by ${report.approved_by_name}` : ''}
            {report.approved_at ? ` · ${shortDate(report.approved_at)}` : ''}
          </span>
        ) : (
          <form action={approveFromEmailAction}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="user_id" value={report.user_id} />
            <button className="btn-primary text-sm" type="submit">
              Approve
            </button>
          </form>
        )}
      </div>

      {report.total_hours > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-right text-xs uppercase tracking-wide text-brand-gray">
                {report.days.map((d) => (
                  <th key={d.date} className="px-2 py-1.5 font-semibold">
                    {dayHeader(d.date)}
                  </th>
                ))}
                <th className="px-2 py-1.5 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-black/5 text-right">
                {report.days.map((d) => (
                  <td key={d.date} className="px-2 py-2 text-brand-ink">
                    {d.hours > 0 ? d.hours.toFixed(1) : '—'}
                  </td>
                ))}
                <td className="px-2 py-2 font-semibold text-brand-ink">
                  {report.total_hours.toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {report.notes.length > 0 && (
        <p className="mt-2 text-xs text-brand-gray">Notes: {report.notes.join(' · ')}</p>
      )}
    </div>
  );
}

export default async function ApproveTimePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const branding = await getBranding();

  const parsed = token ? await validateApprovalToken(token) : null;
  const summary = parsed ? await managerWeekSummary(parsed.managerId, parsed.weekStart) : null;

  const firstName = summary ? summary.manager_name.trim().split(/\s+/)[0] || '' : '';
  const unapproved = summary ? summary.reports.filter((r) => !r.approved) : [];

  return (
    <main className="flex min-h-screen items-start justify-center bg-brand-ink px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={branding.full}
            alt="Cornerstone Facility Solutions"
            className="h-16 w-auto max-w-[280px] object-contain"
          />
        </div>

        {!summary || !token ? (
          <div className="card p-6">
            <h1 className="brand-heading mb-1 text-lg text-brand-ink">Weekly time approval</h1>
            <p className="text-sm text-brand-gray">
              This approval link is invalid or has expired. Approval links are good for 14 days —
              you can still approve your team&apos;s hours from the Timesheets page after signing
              in, or ask an admin to resend the approval email.
            </p>
          </div>
        ) : (
          <div className="card p-6">
            <h1 className="brand-heading mb-1 text-lg text-brand-ink">
              {firstName ? `${firstName}, your` : 'Your'} team&apos;s hours
            </h1>
            <p className="mb-5 text-sm text-brand-gray">
              Week of {weekLabel(summary.week_start)} — review each direct report&apos;s hours and
              approve them for payroll.
            </p>

            {summary.reports.length === 0 ? (
              <p className="text-sm text-brand-gray">
                You have no active direct reports right now.
              </p>
            ) : (
              <div className="space-y-4">
                {summary.reports.map((r) => (
                  <ReportCard key={r.user_id} report={r} token={token} />
                ))}

                {unapproved.length > 1 && (
                  <form action={approveAllFromEmailAction} className="pt-2">
                    <input type="hidden" name="token" value={token} />
                    <button className="btn-primary w-full" type="submit">
                      Approve all ({unapproved.length} remaining)
                    </button>
                  </form>
                )}
                {unapproved.length === 0 && (
                  <p className="rounded-lg bg-brand-green/15 px-3 py-2 text-center text-sm font-medium text-brand-green-dark">
                    All hours for this week are approved. You&apos;re done!
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-white/50">
          Cornerstone Facility Solutions · DLOM Group
        </p>
      </div>
    </main>
  );
}
