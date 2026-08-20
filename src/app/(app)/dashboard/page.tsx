import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDashboard } from '@/lib/data';
import { money, shortDate } from '@/lib/format';
import { PageHeader, StatCard } from '@/components/ui';
import { QuotesByWeek, PipelineByCustomer, SoldByStatus } from './Charts';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role === 'employee') redirect('/time');

  const d = await getDashboard();

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Prospective pipeline vs. sold & in-progress work"
      >
        <Link href="/quotes" className="btn-secondary">
          View Quotes
        </Link>
        <Link href="/projects" className="btn-primary">
          Projects
        </Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Pipeline" value={money(d.totalPipeline)} accent="gray" hint={`${d.proposalCount} proposals`} />
        <StatCard label="Open Pipeline" value={money(d.openPipeline)} accent="gray" hint={`${d.openQuoteCount} open quotes`} />
        <StatCard label="Sold / In-Progress" value={money(d.soldTotal)} accent="green" hint={`${d.activeProjectCount} active jobs`} />
        <StatCard
          label="Win Rate"
          value={
            d.soldTotal + d.openPipeline > 0
              ? Math.round((d.soldTotal / (d.soldTotal + d.openPipeline)) * 100) + '%'
              : '—'
          }
          accent="amber"
          hint="Sold vs open value"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="brand-heading mb-4 text-sm text-brand-ink">
            Total Quote Value by Week
            <span className="ml-2 font-normal text-brand-gray">Last 8 weeks</span>
          </h2>
          <QuotesByWeek data={d.quotesByWeek} />
        </div>
        <div className="card p-5">
          <h2 className="brand-heading mb-4 text-sm text-brand-ink">Sold by Status</h2>
          <SoldByStatus data={d.soldByStatus} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="brand-heading mb-4 text-sm text-brand-ink">
            Pipeline by Customer
            <span className="ml-2 font-normal text-brand-gray">Top 10</span>
          </h2>
          <PipelineByCustomer data={d.pipelineByCustomer} />
        </div>

        <div className="card p-5">
          <h2 className="brand-heading text-sm text-brand-ink">Lost / Sold</h2>
          <p className="mb-4 mt-0.5 text-xs text-brand-gray">Quotes decided in the past 14 days</p>
          {d.recentDecisions.length === 0 ? (
            <p className="py-6 text-center text-sm text-brand-gray">
              No quotes marked sold or lost recently.
            </p>
          ) : (
            <ul className="divide-y divide-surface-line">
              {d.recentDecisions.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-brand-ink">
                      {r.quote_number ? (
                        <span className="tnum mr-2 text-xs text-brand-gray">{r.quote_number}</span>
                      ) : null}
                      {r.customer}
                    </p>
                    {r.project_name && (
                      <p className="truncate text-xs text-brand-gray">{r.project_name}</p>
                    )}
                    <p className="tnum text-xs text-brand-gray">{shortDate(r.updated_at)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`badge ${
                        r.status === 'sold'
                          ? 'bg-brand-green/15 text-brand-green-dark'
                          : 'bg-brand-gray/10 text-brand-gray'
                      }`}
                    >
                      {r.status === 'sold' ? 'Sold' : 'Lost'}
                    </span>
                    <span className="tnum text-xs font-semibold text-brand-ink">{money(r.bid_value)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
