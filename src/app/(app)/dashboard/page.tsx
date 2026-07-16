import Link from 'next/link';
import { getDashboard } from '@/lib/data';
import { money } from '@/lib/format';
import { PageHeader, StatCard } from '@/components/ui';
import { PipelineVsSold, PipelineByCustomer, SoldByStatus } from './Charts';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const d = getDashboard();

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
          Active Projects
        </Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Pipeline" value={money(d.totalPipeline)} accent="gray" hint={`${d.proposalCount} proposals`} />
        <StatCard label="Open Pipeline" value={money(d.openPipeline)} accent="gray" hint={`${d.openQuoteCount} open quotes`} />
        <StatCard label="Sold / In-Progress" value={money(d.soldTotal)} accent="green" hint={`${d.activeProjectCount} active jobs`} />
        <StatCard
          label="Win Rate"
          value={
            d.totalPipeline + d.soldTotal > 0
              ? Math.round((d.soldTotal / (d.soldTotal + d.openPipeline)) * 100) + '%'
              : '—'
          }
          accent="amber"
          hint="Sold vs open value"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="brand-heading mb-4 text-sm text-brand-gray">
            Prospective vs. Sold / In-Progress
          </h2>
          <PipelineVsSold total={d.totalPipeline} open={d.openPipeline} sold={d.soldTotal} />
        </div>
        <div className="card p-5">
          <h2 className="brand-heading mb-4 text-sm text-brand-gray">Sold by Status</h2>
          <SoldByStatus data={d.soldByStatus} />
        </div>
      </div>

      <div className="mt-6 card p-5">
        <h2 className="brand-heading mb-4 text-sm text-brand-gray">Pipeline by Customer</h2>
        <PipelineByCustomer data={d.pipelineByCustomer} />
      </div>
    </div>
  );
}
