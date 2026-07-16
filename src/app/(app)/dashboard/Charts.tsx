'use client';

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
import { money, moneyCompact } from '@/lib/format';
import type { ProjectStatus } from '@/lib/types';

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

export function PipelineVsSold({ total, open, sold }: { total: number; open: number; sold: number }) {
  const data = [
    { name: 'Total Pipeline', value: total, fill: GRAY },
    { name: 'Open Pipeline', value: open, fill: GREEN_DARK },
    { name: 'Sold / In-Progress', value: sold, fill: GREEN },
  ];
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: GRAY }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={(v) => moneyCompact(v)}
            tick={{ fontSize: 11, fill: GRAY }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip content={<CurrencyTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={90}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              formatter={(v: number) => moneyCompact(v)}
              style={{ fontSize: 12, fontWeight: 700, fill: INK }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PipelineByCustomer({ data }: { data: { customer: string; value: number }[] }) {
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
          <Bar dataKey="value" fill={GREEN} radius={[0, 5, 5, 0]} barSize={20}>
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: number) => moneyCompact(v)}
              style={{ fontSize: 11, fontWeight: 600, fill: GRAY }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SoldByStatus({
  data,
}: {
  data: { status: ProjectStatus; label: string; value: number; count: number }[];
}) {
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
          <li key={d.status} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-brand-ink">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLOR[d.status] }} />
              {d.label} <span className="text-xs text-brand-gray">({d.count})</span>
            </span>
            <span className="font-semibold text-brand-ink">{money(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
