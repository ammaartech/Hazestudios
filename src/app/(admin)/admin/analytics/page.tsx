import Link from "next/link";
import { Activity, ArrowUpRight, ChartNoAxesCombined } from "lucide-react";
import { getDashboard } from "@/lib/analytics/dashboard";
import { AnalyticsControls, LastRefreshed } from "./analytics-controls";
import { AnalyticsDashboard } from "./analytics-dashboard";
import { CUSTOM_RANGE, compareWindow, formatRangeLabel, parseCompareMode, resolveRange } from "@/lib/analytics/ranges";
import "./analytics.css";

export const metadata = { title: "Analytics" };
function dayValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    compare?: string;
  }>;
}) {
  const params = await searchParams;
  const compare = parseCompareMode(params.compare);
  const { from, to, preset } = resolveRange(params.range, params.from, params.to);
  const rangeValue = preset.custom ? CUSTOM_RANGE : preset.value;

  const dashboard = await getDashboard(from, to, compare);
  const { currency } = dashboard.current;

  const refreshedAt = new Date().toISOString();
  const rangeLabel = formatRangeLabel(from, to);
  const prevWindow = compareWindow(from, to, compare);
  const compareLabel = prevWindow
    ? formatRangeLabel(prevWindow.from, prevWindow.to)
    : undefined;

  return <div data-full-bleed className="analytics-page">
    <header className="analytics-page-header">
      <div><div className="analytics-title"><ChartNoAxesCombined size={20} /><h1>Analytics</h1></div><p>A clearer view of your store&apos;s performance.</p></div>
      <nav aria-label="Analytics pages"><Link href="/admin/analytics/live"><Activity size={14} />Live view</Link><Link href="/admin/analytics/reports" className="analytics-primary-action">Explore reports<ArrowUpRight size={14} /></Link></nav>
    </header>
    <div className="analytics-toolbar"><AnalyticsControls range={rangeValue} rangeLabel={preset.custom ? rangeLabel : preset.label} from={dayValue(from)} to={dayValue(to)} compare={compare} currency={currency} /><LastRefreshed at={refreshedAt} /></div>
    <AnalyticsDashboard dashboard={dashboard} rangeLabel={rangeLabel} compareLabel={compareLabel} />
  </div>;
}
