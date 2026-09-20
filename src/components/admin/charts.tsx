"use client";

import { AnalyticsTrend } from "@/components/admin/bklit-analytics";
import { RankedBars } from "@/components/admin/analytics-charts";
import type { ValueFormat } from "@/lib/analytics/format";

export interface TrendPoint { label: string; date?: string; value: number; previous?: number }
export function TrendLineChart({ data, money = true, currency = "INR", height = 200, label = "Value", format }: {
  data: TrendPoint[]; money?: boolean; currency?: string; height?: number; label?: string; format?: ValueFormat;
}) {
  return <AnalyticsTrend data={data.filter((row): row is TrendPoint & { date: string } => Boolean(row.date)).map(row => ({ ...row, date: row.date }))} format={format ?? (money ? "money" : "number")} currency={currency} height={height} label={label} />;
}

export function RankedBarChart({ data, money = true, currency = "INR" }: {
  data: { name: string; value: number }[]; money?: boolean; currency?: string;
}) {
  return <RankedBars data={data} format={money ? "money" : "number"} currency={currency} primaryLabel={money ? "Sales" : "Count"} />;
}
