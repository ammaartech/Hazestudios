"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import { curveLinear } from "@visx/curve";
import { AreaChart } from "@/components/charts/area-chart";
import { Area } from "@/components/charts/area";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { PieCenter } from "@/components/charts/pie-center";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { compactValue, fullValue, type ValueFormat } from "@/lib/analytics/format";

export const ANALYTICS_COLORS = ["#635bdb", "#249b91", "#db9950", "#9591bc", "#5b8ec6"];
const subscribeMounted = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;
export interface TrendPoint { date: string; label: string; value: number; previous?: number }

export function AnalyticsTrend({ data, format = "number", currency = "INR", label, comparison, height = 280, timeOnly = false }: {
  data: TrendPoint[]; format?: ValueFormat; currency?: string; label: string; comparison?: string; height?: number; timeOnly?: boolean;
}) {
  const reduced = useReducedMotion();
  const points = useMemo(() => data.map(row => ({ ...row, date: new Date(row.date) })), [data]);
  if (!points.length) return <AnalyticsEmpty>No data in this date range.</AnalyticsEmpty>;
  return <div className="analytics-chart" role="img" aria-label={`${label} over time${comparison ? ` compared with ${comparison}` : ""}. Exact values available in the data table.`}>
    <AreaChart data={points} style={{ height, aspectRatio: "auto" }} margin={{ top: 18, right: 14, bottom: 32, left: 62 }} animationDuration={reduced ? 0 : 450} yDomainTween={!reduced}>
      <Grid horizontal numTicksRows={4} />
      {comparison && <Area dataKey="previous" stroke="#9a98a8" fill="#9a98a8" fillOpacity={0.035} strokeWidth={1.5} curve={curveLinear} />}
      <Area dataKey="value" stroke={ANALYTICS_COLORS[0]} fill={ANALYTICS_COLORS[0]} fillOpacity={0.2} strokeWidth={2.25} curve={curveLinear} />
      {!timeOnly && <XAxis numTicks={4} />}
      <YAxis numTicks={4} formatValue={v => format === "number" && !Number.isInteger(v) ? "" : compactValue(v, format, currency)} />
      <ChartTooltip showDatePill={false} damping={reduced ? 0 : 20} content={({ point }) => <div className="analytics-tooltip">
        <p>{String(point.label)}</p><strong>{fullValue(Number(point.value), format, currency)}</strong>
        {comparison && <small>{comparison}: {fullValue(Number(point.previous ?? 0), format, currency)}</small>}
      </div>} />
    </AreaChart>
    {timeOnly && <div className="flex justify-between text-[11px] text-muted-foreground"><span>{data[0]?.label}</span><span>{data.at(-1)?.label}</span></div>}
  </div>;
}

export function AnalyticsEmpty({ children }: { children: React.ReactNode }) {
  return <div className="analytics-empty"><span className="analytics-empty-mark" aria-hidden="true">—</span><p>{children}</p></div>;
}

export function DeviceDonut({ data }: { data: { name: string; value: number }[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const mounted = useSyncExternalStore(subscribeMounted, clientMounted, serverMounted);
  const reduced = useReducedMotion();
  const rows = data.filter(row => row.value > 0).map((row, i) => ({ label: row.name.charAt(0).toUpperCase() + row.name.slice(1), value: row.value, color: ANALYTICS_COLORS[i % ANALYTICS_COLORS.length] }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!total) return <AnalyticsEmpty>No sessions in this date range.</AnalyticsEmpty>;
  return <div className="analytics-device">
    <div className="analytics-donut" aria-hidden="true">{mounted ? <PieChart data={rows} size={200} innerRadius={73} padAngle={0.035} cornerRadius={5} hoveredIndex={hovered} onHoverChange={setHovered}>
      {rows.map((row, index) => <PieSlice key={row.label} index={index} animate={!reduced} showGlow={false} hoverEffect={reduced ? "none" : "grow"} />)}
      <PieCenter defaultLabel="Sessions" />
    </PieChart> : <div className="flex size-[200px] items-center justify-center text-3xl font-semibold">{total.toLocaleString("en-IN")}</div>}</div>
    <ul className="analytics-device-legend">{rows.map((row, index) => <li key={row.label}><button type="button" onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} onClick={() => setHovered(hovered === index ? null : index)} aria-pressed={hovered === index}>
      <span className="analytics-swatch" style={{ background: row.color }} /><span>{row.label}</span><strong>{row.value.toLocaleString("en-IN")}</strong><small>{(row.value / total * 100).toFixed(1)}%</small>
    </button></li>)}</ul>
  </div>;
}

export function AnalyticsFunnel({ steps }: { steps: { label: string; value: number }[] }) {
  const reduced = useReducedMotion();
  if (!steps[0]?.value) return <AnalyticsEmpty>No tracked sessions in this date range.</AnalyticsEmpty>;
  return <div>
    <div aria-hidden="true"><FunnelChart data={steps} color={ANALYTICS_COLORS[0]} style={{ height: 130 }} layers={3} showLabels={false} showValues={false} showPercentage={false} staggerDelay={reduced ? 0 : 0.04} enterTransition={{ duration: reduced ? 0 : 0.4 }} /></div>
    <ol className="analytics-funnel-steps">{steps.map((step, index) => <li key={step.label}><span><i>{index + 1}</i>{step.label}</span><strong>{step.value.toLocaleString("en-IN")}</strong><small>{(step.value / steps[0].value * 100).toFixed(1)}%</small></li>)}</ol>
    <p className="analytics-footnote">Share of tracked sessions. Imported orders do not include storefront sessions.</p>
  </div>;
}
