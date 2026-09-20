"use client";

import { useState } from "react";
import Link from "next/link";
import NumberFlow from "@number-flow/react";
import { MotionConfig, useReducedMotion } from "motion/react";
import { ArrowUpRight, ChartNoAxesCombined, Table2 } from "lucide-react";
import type { Dashboard, DashboardPoint, DashboardTotals } from "@/lib/analytics/dashboard";
import { fullValue, type ValueFormat } from "@/lib/analytics/format";
import { AnalyticsEmpty, AnalyticsFunnel, AnalyticsTrend, DeviceDonut } from "@/components/admin/bklit-analytics";
import { RankedBars } from "@/components/admin/analytics-charts";

const metrics: { key: keyof Pick<DashboardPoint, "sales" | "orders" | "sessions" | "aov" | "returningCustomerRate" | "conversionRate">; total: keyof DashboardTotals; label: string; format: ValueFormat }[] = [
  { key: "sales", total: "totalSales", label: "Total sales", format: "money" },
  { key: "orders", total: "orders", label: "Orders", format: "number" },
  { key: "sessions", total: "sessions", label: "Sessions", format: "number" },
  { key: "aov", total: "aov", label: "Average order value", format: "money" },
  { key: "conversionRate", total: "conversionRate", label: "Conversion rate", format: "percent" },
  { key: "returningCustomerRate", total: "returningCustomerRate", label: "Returning customers", format: "percent" },
];

function Change({ value, previous }: { value: number; previous?: number }) {
  if (previous === undefined) return <span className="analytics-change">Selected period</span>;
  if (!previous) return <span className="analytics-change">{value ? "No prior activity" : "No change"}</span>;
  const delta = (value - previous) / Math.abs(previous) * 100;
  return <span className="analytics-change" data-trend={delta > 0 ? "up" : delta < 0 ? "down" : "flat"}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}% <span>vs comparison</span></span>;
}

function Panel({ title, description, children, className = "", action }: { title: string; description?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return <section className={`analytics-panel ${className}`}><header className="analytics-panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>{children}</section>;
}

export function AnalyticsDashboard({ dashboard, rangeLabel, compareLabel }: { dashboard: Dashboard; rangeLabel: string; compareLabel?: string }) {
  const { current, previous } = dashboard;
  const [active, setActive] = useState("sales");
  const [table, setTable] = useState(false);
  const [traffic, setTraffic] = useState("source");
  const [products, setProducts] = useState("sales");
  const reduced = useReducedMotion();
  const metric = metrics.find(row => row.key === active) ?? metrics[0];
  const points = current.series.map((row, index) => ({ date: row.date, label: row.label, value: row[metric.key], previous: previous?.series[index]?.[metric.key] }));
  const money = (value: number) => fullValue(value, "money", current.currency);
  const breakdown = [
    { label: "Gross sales", value: current.totals.grossSales },
    { label: "Discounts", value: -current.totals.discounts },
    { label: "Sales reversals", value: -current.totals.reversals },
    { label: "Net sales", value: current.totals.netSales },
    { label: "Shipping", value: current.totals.shipping },
    ...(current.totals.fees ? [{ label: "Additional fees", value: current.totals.fees }] : []),
    { label: "Return fees", value: current.totals.returnFees },
    { label: "Taxes", value: current.totals.taxes },
  ];
  const trafficRows = traffic === "source" ? current.byReferrer : current.byLocation;
  const productRows = products === "sales" ? current.topProductsBySales.map(row => ({ name: row.name, value: row.revenue })) : current.topProductsByUnits.map(row => ({ name: row.name, value: row.units, secondary: row.reversedUnits }));
  return <MotionConfig reducedMotion="user"><div className="analytics-workspace">
    <div className="analytics-kpis" role="group" aria-label="Choose metric to explore">{metrics.map(row => <button type="button" className="analytics-kpi" key={row.key} aria-pressed={active === row.key} onClick={() => setActive(row.key)}>
      <span className="analytics-kpi-label">{row.label}<ArrowUpRight size={14} /></span>
      <NumberFlow className="analytics-kpi-value" value={current.totals[row.total]} locales="en-IN" animated={!reduced} format={row.format === "money" ? { style: "currency", currency: current.currency, maximumFractionDigits: 2 } : { maximumFractionDigits: row.format === "percent" ? 2 : 0 }} suffix={row.format === "percent" ? "%" : undefined} />
      <Change value={current.totals[row.total]} previous={previous?.totals[row.total]} />
    </button>)}</div>

    <div className="analytics-primary-grid">
      <Panel title={`${metric.label} over time`} description={rangeLabel} className="analytics-explorer" action={<button className="analytics-view-toggle" type="button" aria-pressed={table} onClick={() => setTable(!table)}>{table ? <ChartNoAxesCombined size={14} /> : <Table2 size={14} />}{table ? "Chart" : "View data"}</button>}>
        {table ? <div className="analytics-data-scroll"><table className="analytics-data-table"><caption className="sr-only">{metric.label} by period</caption><thead><tr><th>Period</th><th>{metric.label}</th>{compareLabel && <th>{compareLabel}</th>}</tr></thead><tbody>{points.map(point => <tr key={point.date}><td>{point.label}</td><td>{fullValue(point.value, metric.format, current.currency)}</td>{compareLabel && <td>{fullValue(point.previous ?? 0, metric.format, current.currency)}</td>}</tr>)}</tbody></table></div> : <AnalyticsTrend data={points} label={metric.label} comparison={compareLabel} format={metric.format} currency={current.currency} height={285} />}
        <div className="analytics-chart-legend"><span><i />{rangeLabel}</span>{compareLabel && <span><i className="comparison" />{compareLabel}</span>}<small>{dashboard.bucket === "hour" ? "Hourly" : dashboard.bucket === "month" ? "Monthly" : dashboard.bucket === "week" ? "Weekly" : "Daily"} {metric.format === "percent" ? "rate" : metric.key === "aov" ? "average" : "totals"}</small></div>
      </Panel>
      <Panel title="Sales breakdown" description="How your total comes together" action={<Link aria-label="Open sales report" href="/admin/analytics/reports/sales-over-time"><ArrowUpRight size={16} /></Link>}>
        <dl className="analytics-breakdown">{breakdown.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{money(row.value)}</dd></div>)}<div className="analytics-breakdown-total"><dt>Total sales</dt><dd>{money(current.totals.totalSales)}</dd></div></dl>
      </Panel>
    </div>

    <div className="analytics-secondary-grid">
      <Panel title="Conversion journey" description="From first visit to completed checkout" action={<span className="analytics-panel-stat">{current.totals.conversionRate.toFixed(2)}%</span>}>
        <AnalyticsFunnel steps={[{ label: "Sessions", value: current.funnel.sessions }, { label: "Added to cart", value: current.funnel.addedToCart }, { label: "Reached checkout", value: current.funnel.reachedCheckout }, { label: "Completed checkout", value: current.funnel.completed }]} />
      </Panel>
      <Panel title="Sessions by device" description="Where your customers browse"><DeviceDonut data={current.byDevice} /></Panel>
    </div>

    <div className="analytics-secondary-grid">
      <Panel title="Traffic acquisition" description="Sessions by source and location" action={<div className="analytics-segmented" role="group" aria-label="Traffic breakdown">{["source", "location"].map(key => <button type="button" key={key} aria-pressed={traffic === key} onClick={() => setTraffic(key)}>{key === "source" ? "Source" : "Location"}</button>)}</div>}>
        {trafficRows.length ? <RankedBars data={trafficRows} primaryLabel="Sessions" /> : <AnalyticsEmpty>No sessions in this date range.</AnalyticsEmpty>}
      </Panel>
      <Panel title="Product performance" description="Your leading products in this period" action={<div className="analytics-segmented" role="group" aria-label="Product measure">{["sales", "units"].map(key => <button type="button" key={key} aria-pressed={products === key} onClick={() => setProducts(key)}>{key === "sales" ? "Sales" : "Units"}</button>)}</div>}>
        {productRows.length ? <RankedBars data={productRows} primaryLabel={products === "sales" ? "Sales" : "Ordered"} secondaryLabel={products === "units" ? "Reversed" : undefined} format={products === "sales" ? "money" : "number"} currency={current.currency} /> : <AnalyticsEmpty>No products ordered in this date range.</AnalyticsEmpty>}
      </Panel>
    </div>
    <p className="analytics-footnote">{dashboard.configured ? "Store analytics · Sales, traffic and customer behavior for your selected period." : "Connect Supabase to populate this dashboard."}</p>
  </div></MotionConfig>;
}
