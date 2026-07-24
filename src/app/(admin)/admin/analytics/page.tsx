import { Suspense } from "react";
import Link from "next/link";
import { BarChart3, ArrowRight } from "lucide-react";
import {
  ChannelDonut,
  RankedBarChart,
  TrendAreaChart,
  TrendLineChart,
  type TrendPoint,
} from "@/components/admin/charts";
import { Sparkline } from "@/components/admin/sparkline";
import { formatMoney } from "@/lib/format";
import { getSalesBreakdown } from "@/lib/analytics/queries";
import { AnalyticsControls } from "./analytics-controls";
import {
  DEFAULT_RANGE,
  resolveRange,
  type RangeValue,
} from "@/lib/analytics/ranges";
import { cn } from "@/lib/utils";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function KpiCard({
  label,
  value,
  change,
  trend,
}: {
  label: string;
  value: string;
  change: number | null;
  trend: number[];
}) {
  const rounded = change === null ? null : Math.round(change);

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-[13px] font-medium text-muted-foreground underline decoration-dotted underline-offset-4">
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-xl font-semibold tabular-nums tracking-tight">
            {value}
          </p>
          {rounded !== null && (
            <p
              className={cn(
                "mt-0.5 text-xs font-medium tabular-nums",
                rounded === 0
                  ? "text-muted-foreground"
                  : rounded > 0
                    ? "text-emerald-600 dark:text-emerald-500"
                    : "text-rose-600 dark:text-rose-500"
              )}
            >
              {rounded > 0 ? "+" : ""}
              {rounded}%
            </p>
          )}
        </div>
        <Sparkline
          data={trend}
          width={72}
          height={28}
          className="text-(--viz-series-1)"
        />
      </div>
    </div>
  );
}

function Card({
  title,
  headline,
  children,
  className,
  action,
}: {
  title: string;
  headline?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold tracking-tight underline decoration-dotted underline-offset-4">
            {title}
          </h2>
          {headline && (
            <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">
              {headline}
            </p>
          )}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyPlot({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-12 text-center text-sm text-muted-foreground">{children}</p>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; compare?: string }>;
}) {
  const { range, compare } = await searchParams;
  const rangeValue = (range ?? DEFAULT_RANGE) as RangeValue;
  const comparing = compare === "1";
  const { from, to, preset } = resolveRange(range);

  const sales = await getSalesBreakdown(from, to, true);
  const { totals, previous, series, previousSeries, currency } = sales;

  const kpis = [
    {
      label: "Gross sales",
      value: formatMoney(totals.grossSales, currency),
      change: previous ? delta(totals.grossSales, previous.grossSales) : null,
      trend: series.map((p) => p.sales),
    },
    {
      label: "Returning customer rate",
      value: `${totals.returningCustomerRate.toFixed(1)}%`,
      change: previous
        ? delta(totals.returningCustomerRate, previous.returningCustomerRate)
        : null,
      trend: series.map((p) => p.sessions),
    },
    {
      label: "Orders fulfilled",
      value: totals.ordersFulfilled.toLocaleString(),
      change: previous
        ? delta(totals.ordersFulfilled, previous.ordersFulfilled)
        : null,
      trend: series.map((p) => p.orders),
    },
    {
      label: "Orders",
      value: totals.orders.toLocaleString(),
      change: previous ? delta(totals.orders, previous.orders) : null,
      trend: series.map((p) => p.orders),
    },
  ];

  // Align the comparison series by index rather than by date — the windows are
  // equal length, so position n in each is the same offset from its own start.
  const salesTrend: TrendPoint[] = series.map((p, i) => ({
    label: p.label,
    value: p.sales,
    previous: comparing ? (previousSeries[i]?.sales ?? 0) : undefined,
  }));

  const aovTrend: TrendPoint[] = series.map((p) => ({
    label: p.label,
    value: p.aov,
  }));

  const breakdown = [
    { label: "Gross sales", value: totals.grossSales, strong: false },
    { label: "Discounts", value: -totals.discounts, strong: false },
    { label: "Returns", value: -totals.returns, strong: false },
    { label: "Net sales", value: totals.netSales, strong: true },
    { label: "Shipping charges", value: totals.shipping, strong: false },
    { label: "Taxes", value: totals.taxes, strong: false },
    { label: "Total sales", value: totals.totalSales, strong: true },
  ];

  const hasSales = totals.totalSales > 0;

  return (
    <div data-full-bleed>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 md:px-8">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* AnalyticsControls reads useSearchParams, which needs a boundary. */}
          <Suspense
            fallback={<div className="h-8 w-64 rounded-lg bg-muted" />}
          >
            <AnalyticsControls range={rangeValue} compare={comparing} />
          </Suspense>
          <Link
            href="/admin/analytics/reports"
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[13px] font-medium text-background transition-opacity duration-150 hover:opacity-90"
          >
            All reports
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>

      <div className="space-y-4 px-4 py-5 md:px-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Card
            title="Total sales over time"
            headline={formatMoney(totals.totalSales, currency)}
          >
            {series.length === 0 ? (
              <EmptyPlot>No data for this date range.</EmptyPlot>
            ) : (
              <TrendAreaChart
                data={salesTrend}
                currency={currency}
                compareLabel={comparing ? "Previous period" : undefined}
              />
            )}
          </Card>

          {/* A breakdown is a list of labelled amounts, not a chart — a stacked
              bar here would make seven values harder to read, not easier. */}
          <Card title="Total sales breakdown">
            <dl className="divide-y text-sm">
              {breakdown.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-4 py-2.5"
                >
                  <dt
                    className={cn(
                      row.strong ? "font-medium" : "text-muted-foreground"
                    )}
                  >
                    {row.label}
                  </dt>
                  <dd
                    className={cn(
                      "tabular-nums",
                      row.strong ? "font-semibold" : "text-foreground"
                    )}
                  >
                    {formatMoney(row.value, currency)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Total sales by sales channel">
            {hasSales ? (
              <ChannelDonut
                data={sales.byChannel.map((c) => ({
                  name: c.name,
                  value: c.revenue,
                }))}
                currency={currency}
              />
            ) : (
              <EmptyPlot>No sales in this period.</EmptyPlot>
            )}
          </Card>

          <Card
            title="Average order value over time"
            headline={formatMoney(totals.aov, currency)}
          >
            {series.length === 0 ? (
              <EmptyPlot>No data for this date range.</EmptyPlot>
            ) : (
              <TrendLineChart data={aovTrend} currency={currency} />
            )}
          </Card>

          <Card title="Total sales by product">
            {sales.byProduct.length === 0 ? (
              <EmptyPlot>No products sold in this period.</EmptyPlot>
            ) : (
              <RankedBarChart
                data={sales.byProduct
                  .slice(0, 5)
                  .map((p) => ({ name: p.name, value: p.revenue }))}
                currency={currency}
              />
            )}
          </Card>
        </div>

        <p className="text-xs text-muted-foreground">
          Showing {preset.label.toLowerCase()} · {series.length} data points ·{" "}
          {totals.sessions.toLocaleString()} sessions
        </p>
      </div>
    </div>
  );
}
