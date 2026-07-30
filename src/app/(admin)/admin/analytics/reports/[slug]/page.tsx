import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RankedBarChart, TrendLineChart } from "@/components/admin/charts";
import { findReport, REPORTS } from "@/lib/analytics/report-definitions";
import { runReport } from "@/lib/analytics/reports";
import { resolveRange, DEFAULT_RANGE } from "@/lib/analytics/ranges";
import { CsvExportButton } from "../report-controls";
import { RecordView, ReportRangeControls } from "./report-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return { title: findReport(slug)?.name ?? "Report" };
}

/** Pre-registers the known slugs so unknown ones 404 rather than render empty. */
export function generateStaticParams() {
  return REPORTS.map((r) => ({ slug: r.slug }));
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug } = await params;
  const { range } = await searchParams;

  const report = findReport(slug);
  if (!report) notFound();

  const { from, to, preset } = resolveRange(range);
  const result = await runReport(slug, from, to);

  const hasChart = Boolean(result.chart?.length);
  const chartData = result.chart ?? [];

  return (
    <div data-full-bleed>
      <RecordView slug={slug} />

      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 md:px-8">
        <div className="min-w-0">
          <Link
            href="/admin/analytics/reports"
            className="mb-1.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Reports
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">
              {report.name}
            </h1>
            <Badge variant="secondary" className="font-normal">
              {report.category}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Suspense fallback={<div className="h-8 w-36 rounded-lg bg-muted" />}>
            <ReportRangeControls range={range ?? DEFAULT_RANGE} />
          </Suspense>
          <CsvExportButton
            headers={result.headers}
            rows={result.rows}
            filename={`${slug}.csv`}
          />
        </div>
      </div>

      <div className="space-y-4 px-4 py-5 md:px-8">
        {result.rows.length === 0 ? (
          <div className="rounded-xl border bg-card py-20 text-center">
            <p className="text-sm font-medium">No data for this date range</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a wider range — currently showing {preset.label.toLowerCase()}.
            </p>
          </div>
        ) : (
          <>
            {hasChart && (
              <section className="rounded-xl border bg-card p-4">
                <h2 className="text-[13px] font-semibold tracking-tight">
                  {report.name}
                </h2>
                <div className="mt-4">
                  {result.chartKind === "line" ? (
                    <TrendLineChart
                      data={chartData.map((d) => ({
                        label: d.label,
                        value: d.value,
                      }))}
                      money={result.money ?? false}
                      height={260}
                    />
                  ) : (
                    <RankedBarChart
                      data={chartData.map((d) => ({
                        name: d.label,
                        value: d.value,
                      }))}
                    />
                  )}
                </div>
              </section>
            )}

            <section className="overflow-hidden rounded-xl border bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {result.headers.map((header, i) => (
                        <TableHead
                          key={header}
                          className={i > 0 ? "text-right" : undefined}
                        >
                          {header}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((row, i) => (
                      <TableRow key={i}>
                        {row.map((cell, j) => (
                          <TableCell
                            key={j}
                            className={
                              j === 0
                                ? "font-medium"
                                : "text-right tabular-nums"
                            }
                          >
                            {cell}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                {result.rows.length} row{result.rows.length === 1 ? "" : "s"} ·{" "}
                {preset.label.toLowerCase()}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
