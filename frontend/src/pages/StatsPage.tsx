import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { api } from "../lib/api";
import clsx from "clsx";

const RANGES = [7, 30, 90] as const;
const PALETTE = ["#F97316", "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444", "#6B7280"];

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function TotalsRow({ days }: { days: number }) {
  const { data } = useQuery({ queryKey: ["stats-totals", days], queryFn: () => api.statsTotals(days) });
  const cells = [
    { label: "Messages", value: data ? data.messages.toLocaleString() : "—" },
    { label: "Input tokens", value: data ? compact(data.input) : "—" },
    { label: "Output tokens", value: data ? compact(data.output) : "—" },
    { label: "Cache read", value: data ? compact(data.cacheRead) : "—" },
    { label: "Cache write", value: data ? compact(data.cacheWrite) : "—" },
    { label: "Est. cost", value: data ? `$${data.cost.toFixed(2)}` : "—" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cells.map((c) => (
        <div key={c.label} className="bg-white border border-gray-100 rounded-xl px-4 py-4">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{c.label}</div>
          <div className="text-[24px] font-semibold text-gray-900 mt-1 tabular-nums leading-none">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function DailyChart({ days }: { days: number }) {
  const { data } = useQuery({ queryKey: ["stats-daily", days], queryFn: () => api.statsDaily(days) });
  const series = data?.series ?? [];
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[14px] font-semibold text-gray-900">Daily tokens</span>
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">last {days}d</span>
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F97316" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#F97316" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gCacheR" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#9CA3AF" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#9CA3AF" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gCacheW" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#10B981" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#9CA3AF", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#9CA3AF", fontSize: 10 }} tickFormatter={compact} axisLine={false} tickLine={false} width={44} />
            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "Inter", borderRadius: 8 }} formatter={(v: number) => v.toLocaleString()} />
            <Area type="monotone" dataKey="cacheRead" stackId="1" stroke="#9CA3AF" strokeWidth={1} fill="url(#gCacheR)" />
            <Area type="monotone" dataKey="cacheWrite" stackId="1" stroke="#10B981" strokeWidth={1} fill="url(#gCacheW)" />
            <Area type="monotone" dataKey="input" stackId="1" stroke="#F97316" strokeWidth={1.5} fill="url(#gIn)" />
            <Area type="monotone" dataKey="output" stackId="1" stroke="#3B82F6" strokeWidth={1.5} fill="url(#gOut)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex items-center gap-4 text-[11px] text-gray-500">
        <Legend swatch="#F97316" label="input" />
        <Legend swatch="#3B82F6" label="output" />
        <Legend swatch="#10B981" label="cache write" />
        <Legend swatch="#9CA3AF" label="cache read" />
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: swatch }} />
      <span>{label}</span>
    </span>
  );
}

function ModelDonut({ days }: { days: number }) {
  const { data } = useQuery({ queryKey: ["stats-models", days], queryFn: () => api.statsModels(days) });
  const rows = data?.models ?? [];
  const totalCost = rows.reduce((a, r) => a + r.cost, 0);
  const slices = rows.map((r) => ({ name: r.model, value: r.cost }));
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[14px] font-semibold text-gray-900">Cost by model</span>
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">last {days}d</span>
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2} strokeWidth={0}>
              {slices.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "Inter", borderRadius: 8 }} formatter={(v: number) => `$${v.toFixed(4)}`} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1.5 mt-2">
        {rows.map((r, i) => (
          <div key={r.model} className="flex items-center gap-2 text-[12px]">
            <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="text-gray-700 truncate flex-1 font-mono text-[11px]">{r.model}</span>
            <span className="text-gray-900 font-medium tabular-nums">${r.cost.toFixed(2)}</span>
            <span className="text-gray-400 font-mono text-[10px] tabular-nums w-8 text-right">
              {totalCost > 0 ? `${((r.cost / totalCost) * 100).toFixed(0)}%` : "—"}
            </span>
          </div>
        ))}
        {rows.length === 0 && <div className="text-gray-400 text-[13px] italic">No data yet.</div>}
      </div>
    </div>
  );
}

function TopTools({ days }: { days: number }) {
  const { data } = useQuery({ queryKey: ["stats-tools", days], queryFn: () => api.statsTools(days, 12) });
  const rows = data?.tools ?? [];
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[14px] font-semibold text-gray-900">Top tools</span>
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">last {days}d</span>
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="2 4" horizontal={false} />
            <XAxis type="number" tick={{ fill: "#9CA3AF", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={compact} />
            <YAxis type="category" dataKey="name" tick={{ fill: "#374151", fontSize: 11 }} width={108} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E5E7EB", fontSize: 12, fontFamily: "Inter", borderRadius: 8 }} formatter={(v: number) => v.toLocaleString()} />
            <Bar dataKey="uses" fill="#F97316" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function StatsPage() {
  const [days, setDays] = useState<number>(30);
  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <header className="px-8 pt-6 pb-5 border-b border-gray-100 bg-white">
        <div className="flex items-center justify-between">
          <h1 className="text-[20px] font-semibold text-gray-900">Usage</h1>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setDays(r)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors",
                  days === r ? "border-orange-300 text-orange-600 bg-orange-50" : "border-gray-200 text-gray-500 hover:bg-gray-50"
                )}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="px-8 py-6 space-y-5 animate-rise">
        <TotalsRow days={days} />
        <DailyChart days={days} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <ModelDonut days={days} />
          <TopTools days={days} />
        </div>
      </div>
    </div>
  );
}
