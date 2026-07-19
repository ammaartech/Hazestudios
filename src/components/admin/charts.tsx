"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/format";

const GREEN = "#008060";
const BLUE = "#2570b8";
const GRID = "#e5e5e3";
const MUTED_TEXT = "#5c5f62";

interface TooltipPayloadEntry {
  name?: string;
  value?: number | string;
}

function ChartTooltip({
  active,
  payload,
  label,
  money,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  money?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-0.5 font-medium text-foreground">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-muted-foreground">
          {entry.name}:{" "}
          <span className="font-medium text-foreground tabular-nums">
            {money ? formatMoney(Number(entry.value)) : entry.value}
          </span>
        </p>
      ))}
    </div>
  );
}

export function SalesAreaChart({
  data,
}: {
  data: { date: string; sales: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GREEN} stopOpacity={0.18} />
            <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: MUTED_TEXT }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: MUTED_TEXT }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatMoney(v).replace(".00", "")}
          width={64}
        />
        <Tooltip content={<ChartTooltip money />} cursor={{ stroke: GRID }} />
        <Area
          type="monotone"
          dataKey="sales"
          name="Sales"
          stroke={GREEN}
          strokeWidth={2}
          fill="url(#salesFill)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function OrdersBarChart({
  data,
}: {
  data: { date: string; orders: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: MUTED_TEXT }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: MUTED_TEXT }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={32}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar
          dataKey="orders"
          name="Orders"
          fill={BLUE}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TopProductsChart({
  data,
}: {
  data: { name: string; revenue: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 44)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
      >
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: MUTED_TEXT }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          tickFormatter={(v: number) => formatMoney(v).replace(".00", "")}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12, fill: MUTED_TEXT }}
          tickLine={false}
          axisLine={false}
          width={160}
        />
        <Tooltip content={<ChartTooltip money />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar
          dataKey="revenue"
          name="Revenue"
          radius={[0, 4, 4, 0]}
          maxBarSize={20}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={GREEN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
