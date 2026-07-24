"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/format";

/**
 * Chart set for the admin dashboards.
 *
 * Colour comes from the `--viz-*` tokens in globals.css, which are validated
 * for colour-vision separation against the card surface in both modes. Slots
 * are referenced in fixed order and never cycled — a fourth category folds into
 * "Other" rather than inventing a hue.
 *
 * Shared conventions: recessive grid (horizontal only), 2px strokes, no dots on
 * dense series, and a tooltip on every plot.
 */

const SERIES_1 = "var(--viz-series-1)";
const SERIES_2 = "var(--viz-series-2)";
const SERIES_3 = "var(--viz-series-3)";
const GRID = "var(--viz-grid)";
const AXIS = "var(--viz-axis)";
const MUTED = "var(--viz-muted)";

const CATEGORICAL = [SERIES_1, SERIES_2, SERIES_3];

/** Compact axis money: "₹1.5K" beats "₹1,500.00" on a 40px gutter. */
function compactMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

const axisTick = { fontSize: 11, fill: MUTED };

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  money,
  currency = "USD",
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  money?: boolean;
  currency?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium text-foreground">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 text-muted-foreground">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: entry.color }}
          />
          {entry.name}
          <span className="ml-auto font-medium tabular-nums text-foreground">
            {money
              ? formatMoney(Number(entry.value), currency)
              : Number(entry.value).toLocaleString()}
          </span>
        </p>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export interface TrendPoint {
  label: string;
  value: number;
  /** Same-length previous-period value, when a comparison is on. */
  previous?: number;
}

/**
 * Primary time series. Draws the comparison period as a dashed muted line
 * rather than a second hue — it is the same measure, so giving it categorical
 * identity would imply a second series.
 */
export function TrendAreaChart({
  data,
  money = true,
  currency = "USD",
  height = 260,
  compareLabel,
}: {
  data: TrendPoint[];
  money?: boolean;
  currency?: string;
  height?: number;
  compareLabel?: string;
}) {
  const hasComparison = compareLabel !== undefined;

  return (
    <>
      {hasComparison && (
        <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 rounded-full"
              style={{ background: SERIES_1 }}
            />
            Selected period
          </span>
          <span className="flex items-center gap-1.5">
            {/* Mirrors the dashed stroke used for the comparison line. */}
            <span className="w-4 border-t-2 border-dashed border-muted-foreground" />
            {compareLabel}
          </span>
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES_1} stopOpacity={0.2} />
              <stop offset="100%" stopColor={SERIES_1} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: AXIS }}
            minTickGap={28}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) =>
              money ? compactMoney(v, currency) : String(v)
            }
          />
          <Tooltip
            content={<ChartTooltip money={money} currency={currency} />}
            cursor={{ stroke: AXIS }}
          />
          {hasComparison && (
            <Line
              type="monotone"
              dataKey="previous"
              name={compareLabel}
              stroke={MUTED}
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            name="Selected period"
            stroke={SERIES_1}
            strokeWidth={2}
            fill="url(#trendFill)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}

export function TrendLineChart({
  data,
  money = true,
  currency = "USD",
  height = 200,
}: {
  data: TrendPoint[];
  money?: boolean;
  currency?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: AXIS }}
          minTickGap={28}
        />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) =>
            money ? compactMoney(v, currency) : String(v)
          }
        />
        <Tooltip
          content={<ChartTooltip money={money} currency={currency} />}
          cursor={{ stroke: AXIS }}
        />
        <Line
          type="monotone"
          dataKey="value"
          name="Average order value"
          stroke={SERIES_1}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function OrdersBarChart({
  data,
  height = 260,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: AXIS }}
          minTickGap={28}
        />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={36}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        {/* 4px rounded data-end, square against the baseline. */}
        <Bar
          dataKey="value"
          name="Orders"
          fill={SERIES_1}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal ranked bars — the right form for "which product sold most". */
export function RankedBarChart({
  data,
  currency = "USD",
}: {
  data: { name: string; value: number }[];
  currency?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 40)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: AXIS }}
          tickFormatter={(v: number) => compactMoney(v, currency)}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ ...axisTick, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={150}
        />
        <Tooltip
          content={<ChartTooltip money currency={currency} />}
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
        />
        <Bar
          dataKey="value"
          name="Sales"
          fill={SERIES_1}
          radius={[0, 4, 4, 0]}
          maxBarSize={18}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Channel split. Every slice is direct-labelled in the legend with its value,
 * which is also the relief the aqua slot needs on the light surface.
 */
export function ChannelDonut({
  data,
  currency = "USD",
}: {
  data: { name: string; value: number }[];
  currency?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
      <div className="relative">
        <ResponsiveContainer width={180} height={180}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={58}
              outerRadius={86}
              // 2px surface gap between adjacent segments.
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip money currency={currency} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold">
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency,
              notation: "compact",
              maximumFractionDigits: 1,
            }).format(total)}
          </span>
        </div>
      </div>

      <ul className="space-y-2">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2.5 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: CATEGORICAL[i % CATEGORICAL.length] }}
            />
            <span className="text-muted-foreground">{d.name}</span>
            <span className="ml-auto pl-4 font-medium tabular-nums">
              {formatMoney(d.value, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
