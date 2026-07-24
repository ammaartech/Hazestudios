"use client";

import { useState } from "react";
import { Ruler } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  chartMeasurement,
  inchesToCm,
  type SizeChart,
} from "@/lib/size-chart";
import { cn } from "@/lib/utils";

type Unit = "in" | "cm";

/**
 * Storefront size guide.
 *
 * The chart is stored in inches, but a shopper's tape measure is whichever one
 * they own — so the unit toggle converts at display time rather than asking the
 * merchant to enter both. Ranges survive the conversion ("26-28" → "66–71").
 *
 * Receives an already-parsed and pruned chart: the server decides what is
 * worth showing, so this component never has to reason about empty columns.
 */
export function SizeGuide({
  chart,
  measurements,
  rows,
}: {
  chart: SizeChart;
  /** Measurement keys that at least one size filled in. */
  measurements: string[];
  rows: SizeChart["rows"];
}) {
  const [unit, setUnit] = useState<Unit>("in");

  const convert = (value: string) =>
    unit === "in" ? value : inchesToCm(value);

  return (
    <Dialog>
      <DialogTrigger asChild>
        {/* Sized as a real secondary control rather than a footnote: it sits
            directly under the CTA, so at `meta`'s 11px it read as stray caption
            text instead of something you could press. The uppercase tracking is
            inlined rather than borrowing `.meta`, which is locked to that
            smaller size. */}
        <button
          type="button"
          className="glass glass-on-light glass-pill glass-press inline-flex min-h-13 cursor-pointer items-center gap-2.5 px-8 text-[0.8125rem] font-medium uppercase tracking-[0.14em] text-(--shop-charcoal) hover:text-(--shop-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)"
        >
          <Ruler className="size-4" aria-hidden />
          Size guide
        </button>
      </DialogTrigger>

      <DialogContent className="glass glass-panel max-w-2xl border-0 text-(--shop-ink) sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="display text-2xl">Size guide</DialogTitle>
          <DialogDescription className="text-[var(--shop-mute)]">
            Garment measurements taken flat. If you are between sizes, we
            recommend sizing up.
          </DialogDescription>
        </DialogHeader>

        {/* Unit toggle. One travelling capsule, so the selection slides between
            the two rather than blinking from one to the other. */}
        <div
          className="glass glass-on-light glass-pill relative inline-flex self-start p-1"
          role="group"
          aria-label="Measurement unit"
        >
          <span
            aria-hidden
            className="glass-indicator absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-(--shop-ink)"
            style={{ transform: `translateX(${unit === "in" ? "0%" : "100%"})` }}
          />
          {(["in", "cm"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              aria-pressed={unit === u}
              className={cn(
                "relative z-10 min-h-9 flex-1 cursor-pointer whitespace-nowrap rounded-full px-4 text-xs font-medium uppercase tracking-wider transition-colors duration-300",
                unit === u
                  ? "text-(--shop-canvas)"
                  : "text-(--shop-mute) hover:text-(--shop-ink)"
              )}
            >
              {u === "in" ? "Inches" : "Centimetres"}
            </button>
          ))}
        </div>

        <div className="-mx-6 overflow-x-auto px-6">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--shop-ink)]">
                <th className="py-2.5 pr-4 text-left text-xs font-medium uppercase tracking-wider text-[var(--shop-mute)]">
                  Size
                </th>
                {measurements.map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-[var(--shop-mute)]"
                  >
                    {chartMeasurement(chart, key)?.label ?? key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.size}
                  className="border-b border-[var(--shop-hairline-soft)] last:border-b-0"
                >
                  <th
                    scope="row"
                    className="py-3 pr-4 text-left font-medium"
                  >
                    {row.size}
                  </th>
                  {measurements.map((key) => {
                    const value = (row.values[key] ?? "").trim();
                    return (
                      <td
                        key={key}
                        className="px-4 py-3 text-right tabular-nums text-[var(--shop-charcoal)]"
                      >
                        {/* An em dash, not a zero — this size simply has no
                            such measurement. */}
                        {value ? convert(value) : (
                          <span className="text-[var(--shop-stone)]">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {chart.note && (
          <p className="text-sm leading-relaxed text-[var(--shop-charcoal)]">
            {chart.note}
          </p>
        )}

        {/* How each measurement is taken — the difference between a chart that
            is trusted and one that is guessed at. */}
        <details className="group border-t border-[var(--shop-hairline-soft)] pt-4">
          <summary className="meta cursor-pointer list-none text-[var(--shop-mute)] transition-colors duration-200 hover:text-[var(--shop-ink)]">
            How to measure
            <span className="ml-1.5 inline-block transition-transform duration-200 group-open:rotate-90">
              ›
            </span>
          </summary>
          <dl className="mt-3 space-y-2.5">
            {measurements.map((key) => {
              const m = chartMeasurement(chart, key);
              // Custom measurements carry no how-to-measure copy, so they have
              // nothing to explain here — they still appear as table columns.
              if (!m || !m.help) return null;
              return (
                <div key={key} className="text-sm">
                  <dt className="inline font-medium">{m.label}. </dt>
                  <dd className="inline text-[var(--shop-mute)]">{m.help}</dd>
                </div>
              );
            })}
          </dl>
        </details>
      </DialogContent>
    </Dialog>
  );
}
