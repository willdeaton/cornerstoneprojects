'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
  PieChart,
  Pie,
  LabelList,
} from 'recharts';
import { Modal } from '@/components/Modal';
import { money, moneyCompact } from '@/lib/format';
import type { ProjectStatus } from '@/lib/types';
import type { QuoteLite, ProjectLite, WeekBucket } from '@/lib/data';

const GREEN = '#98C73A';
const GREEN_DARK = '#7BA82C';
const GRAY = '#777777';
const AMBER = '#F0A202';
const INK = '#1F2421';

const STATUS_COLOR: Record<ProjectStatus, string> = {
  not_started: GRAY,
  in_progress: AMBER,
  completed: GREEN,
};

function weekLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CurrencyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs shadow-card">
      {label && <p className="font-semibold text-brand-ink">{label}</p>}
      <p className="text-brand-gray">
        {payload[0].name ? `${payload[0].name}: ` : ''}
        <span className="font-semibold text-brand-ink">{money(payload[0].value)}</span>
      </p>
    </div>
  );
}

function WeekTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as WeekBucket;
  return (
    <div className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs shadow-card">
      <p className="font-semibold text-brand-ink">Week of {weekLabel(p.week_start)}</p>
      <p className="text-brand-gray">
        <span className="font-semibold text-brand-ink">{money(p.value)}</span> ·{' '}
        <span className="font-semibold text-brand-ink">{p.count}</span> quote{p.count === 1 ? '' : 's'}
      </p>
      <p className="mt-0.5 text-[11px] text-brand-gray">Click to see details</p>
    </div>
  );
}

/** Shared drill-down modal shell. */
function Drilldown({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal open onClose={onClose} title={title} wide>
      {children}
    </Modal>
  );
}

function QuoteList({ quotes }: { quotes: QuoteLite[] }) {
  if (!quotes.length) return <p className="py-4 text-center text-sm text-brand-gray">No quotes.</p>;
  return (
    <ul className="divide-y divide-black/5">
      {quotes.map((q) => (
        <li key={q.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium text-brand-ink">
              {q.quote_number ? <span className="mr-2 font-mono text-xs text-brand-gray">{q.quote_number}</span> : null}
              {q.customer}
            </p>
            {q.project_name && <p className="truncate text-xs text-brand-gray">{q.project_name}</p>}
          </div>
          <span className="shrink-0 font-semibold text-brand-ink">{money(q.bid_value)}</span>
        </li>
      ))}
      <li className="pt-3 text-right">
        <Link href="/quotes" className="text-xs font-semibold text-brand-green-dark hover:underline">
          Go to Quotes →
        </Link>
      </li>
    </ul>
  );
}

function ProjectList({ projects }: { projects: ProjectLite[] }) {
  if (!projects.length) return <p className="py-4 text-center text-sm text-brand-gray">No projects.</p>;
  return (
    <ul className="divide-y divide-black/5">
      {projects.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <Link href={`/projects/${p.id}`} className="min-w-0 hover:underline">
            <p className="truncate font-medium text-brand-ink">{p.name}</p>
            <p className="truncate text-xs text-brand-gray">{p.customer}</p>
          </Link>
          <span className="shrink-0 font-semibold text-brand-ink">{money(p.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function QuotesByWeek({ data }: { data: WeekBucket[] }) {
  const [sel, setSel] = useState<WeekBucket | null>(null);
  const chartData = data.map((d) => ({ ...d, label: weekLabel(d.week_start) }));
  const hasData = data.some((d) => d.value > 0);

  return (
    <div className="h-64 w-full">
      {!hasData ? (
        <p className="py-8 text-center text-sm text-brand-gray">No quotes yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: GRAY }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={(v) => moneyCompact(v)}
              tick={{ fontSize: 11, fill: GRAY }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip content={<WeekTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Bar
              dataKey="value"
              radius={[6, 6, 0, 0]}
              maxBarSize={52}
              fill={GREEN}
              cursor="pointer"
              onClick={(_d: any, i: number) => setSel(data[i])}
            >
              <LabelList
                dataKey="value"
                position="top"
                formatter={(v: number) => moneyCompact(v)}
                style={{ fontSize: 12, fontWeight: 700, fill: INK }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {sel && (
        <Drilldown title={`Quotes issued week of ${weekLabel(sel.week_start)}`} onClose={() => setSel(null)}>
          <QuoteList quotes={sel.quotes} />
        </Drilldown>
      )}
    </div>
  );
}

export function PipelineByCustomer({
  data,
}: {
  data: { customer: string; value: number; quotes: QuoteLite[] }[];
}) {
  const [sel, setSel] = useState<{ customer: string; quotes: QuoteLite[] } | null>(null);
  if (!data.length) {
    return <p className="py-8 text-center text-sm text-brand-gray">No open pipeline.</p>;
  }
  const height = Math.max(220, data.length * 42);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
          <XAxis type="number" hide tickFormatter={(v) => moneyCompact(v)} />
          <YAxis
            type="category"
            dataKey="customer"
            width={150}
            tick={{ fontSize: 12, fill: INK }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CurrencyTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Bar
            dataKey="value"
            fill={GREEN}
            radius={[0, 5, 5, 0]}
            barSize={20}
            cursor="pointer"
            onClick={(d: any) => setSel({ customer: d.customer, quotes: d.quotes })}
          >
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: number) => moneyCompact(v)}
              style={{ fontSize: 11, fontWeight: 600, fill: GRAY }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {sel && (
        <Drilldown title={`${sel.customer} — open quotes`} onClose={() => setSel(null)}>
          <QuoteList quotes={sel.quotes} />
        </Drilldown>
      )}
    </div>
  );
}

export function SoldByStatus({
  data,
}: {
  data: { status: ProjectStatus; label: string; value: number; count: number; projects: ProjectLite[] }[];
}) {
  const [sel, setSel] = useState<
    { label: string; projects: ProjectLite[] } | null
  >(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-brand-gray">No sold work yet.</p>;
  }
  return (
    <div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={52}
              outerRadius={80}
              paddingAngle={2}
              stroke="none"
              cursor="pointer"
              onClick={(d: any) => setSel({ label: d.label, projects: d.projects })}
            >
              {data.map((d) => (
                <Cell key={d.status} fill={STATUS_COLOR[d.status]} />
              ))}
            </Pie>
            <Tooltip content={<CurrencyTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 space-y-2">
        {data.map((d) => (
          <li key={d.status}>
            <button
              onClick={() => setSel({ label: d.label, projects: d.projects })}
              className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-sm hover:bg-black/[0.03]"
            >
              <span className="flex items-center gap-2 text-brand-ink">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLOR[d.status] }} />
                {d.label} <span className="text-xs text-brand-gray">({d.count})</span>
              </span>
              <span className="font-semibold text-brand-ink">{money(d.value)}</span>
            </button>
          </li>
        ))}
      </ul>
      {sel && (
        <Drilldown title={`${sel.label} — projects`} onClose={() => setSel(null)}>
          <ProjectList projects={sel.projects} />
        </Drilldown>
      )}
    </div>
  );
}
