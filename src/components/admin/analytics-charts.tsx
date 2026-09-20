"use client";

import { useReducedMotion } from "motion/react";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { fullValue, type ValueFormat } from "@/lib/analytics/format";

/** Bklit horizontal bars with a keyboard-accessible table of exact values. */
export function RankedBars({ data, format = "number", currency = "INR", primaryLabel, secondaryLabel }: {
  data: { name: string; value: number; secondary?: number }[];
  format?: ValueFormat; currency?: string; primaryLabel: string; secondaryLabel?: string;
}) {
  const reduced = useReducedMotion();
  const rows = data.map((row, index) => ({ ...row, category: `${index + 1}. ${row.name}` }));
  return <div className="analytics-ranked">
    {secondaryLabel && <div className="mb-2 flex gap-4 text-xs text-muted-foreground"><span>● {primaryLabel}</span><span style={{ color: "#b87939" }}>● {secondaryLabel}</span></div>}
    <div style={{ height: Math.max(160, rows.length * (secondaryLabel ? 40 : 32)) }} role="img" aria-label={`${primaryLabel} by category. Expand exact values for the complete list.`}>
      <BarChart data={rows} xDataKey="category" orientation="horizontal" className="!aspect-auto !h-full" margin={{ top: 4, right: 8, bottom: 4, left: 130 }} animationDuration={reduced ? 0 : 400} barGap={0.45}>
        <Bar dataKey="value" fill="#635bdb" lineCap={3} animate={!reduced} />
        {secondaryLabel && <Bar dataKey="secondary" fill="#c28a50" lineCap={3} animate={!reduced} />}
        <BarYAxis />
        <ChartTooltip showDatePill={false} showDots={false} damping={reduced ? 0 : 20} content={({ point }) => <div className="analytics-tooltip"><p>{String(point.name)}</p><strong>{primaryLabel}: {fullValue(Number(point.value), format, currency)}</strong>{secondaryLabel && <small>{secondaryLabel}: {fullValue(Number(point.secondary ?? 0), format, currency)}</small>}</div>} />
      </BarChart>
    </div>
    <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">Exact values</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b"><th className="py-2 font-medium">Name</th><th className="p-2 text-right font-medium">{primaryLabel}</th>{secondaryLabel && <th className="p-2 text-right font-medium">{secondaryLabel}</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.category} className="border-b"><td className="py-2 pr-3">{row.name}</td><td className="p-2 text-right tabular-nums whitespace-nowrap">{fullValue(row.value, format, currency)}</td>{secondaryLabel && <td className="p-2 text-right tabular-nums">{fullValue(row.secondary ?? 0, format, currency)}</td>}</tr>)}</tbody></table></div></details>
  </div>;
}
