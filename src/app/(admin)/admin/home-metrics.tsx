"use client";

import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/admin/sparkline";
import { useLiveSnapshot } from "@/lib/analytics/use-live";
import type { LiveSnapshot } from "@/lib/analytics/queries";

export interface StripMetric {
  label: string;
  value: string;
  /** Percent change vs the previous window; null when there is no basis. */
  delta: number | null;
  trend: number[];
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const rounded = Math.round(delta);
  const flat = rounded === 0;

  return (
    <span
      className={cn(
        "text-xs font-medium tabular-nums",
        flat && "text-muted-foreground",
        !flat &&
          (rounded > 0
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-rose-700 dark:text-rose-400")
      )}
    >
      {rounded > 0 ? "+" : ""}
      {rounded}%
    </span>
  );
}

/**
 * The strip across the top of Home: period metrics on the left, a live visitor
 * count on the right. Only the visitor count polls — the period metrics are
 * server-rendered and change on the hour at most.
 */
export function HomeMetrics({
  metrics,
  rangeLabel,
  initialLive,
}: {
  metrics: StripMetric[];
  rangeLabel: string;
  initialLive: LiveSnapshot;
}) {
  const { snapshot } = useLiveSnapshot(initialLive, 15_000);
  const live = snapshot.visitorsRightNow;

  return (
    /*
      One band, two shapes.

      Wrapping is what a desktop wants and what a phone cannot have. Four
      metrics at `min-w-28`, a 144px range caption and a right-aligned live
      counter, all in one wrapping row, came apart at 390px into a tall column
      with the caption stranded beside a gap and the live count floating on a
      line of its own — the widest thing on Home and the least readable.

      Below `md` the caption takes its own line and the metrics become a
      scrolling strip, so the band is two tidy lines and the numbers stay in
      the horizontal rhythm they are meant to be compared in.
    */
    <div className="border-b px-4 py-3.5 md:px-8 xl:px-12">
      <div className="md:flex md:flex-wrap md:items-center md:gap-x-8 md:gap-y-4">
        <div className="min-w-36">
          <p className="text-[13px] font-medium">All channels</p>
          <p className="text-[13px] text-muted-foreground">{rangeLabel}</p>
        </div>

        <div className="strip mt-3 flex-1 gap-x-8 [--strip-gutter:--spacing(4)] md:mt-0 md:flex-wrap md:gap-y-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-28">
              <p className="text-[13px] text-muted-foreground">{metric.label}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-[15px] font-semibold tabular-nums">
                  {metric.value}
                </span>
                <Sparkline
                  data={metric.trend}
                  width={40}
                  height={14}
                  className="text-muted-foreground/60"
                />
                <DeltaBadge delta={metric.delta} />
              </div>
            </div>
          ))}

          {/* Inside the metrics row rather than beside it, so on a phone it is
              the last card in the strip instead of a stranded third line.
              `ml-auto` still pins it to the far right once the row has room to
              spare. */}
          <div className="min-w-28 md:ml-auto md:text-right">
            <p className="text-[13px] text-muted-foreground">Live visitors</p>
            <div className="mt-0.5 flex items-center gap-2 md:justify-end">
              <span className="text-[15px] font-semibold tabular-nums">{live}</span>
              <span className="relative flex size-2.5" title="Live">
                {live > 0 && (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                )}
                <span
                  className={cn(
                    "relative inline-flex size-2.5 rounded-full",
                    live > 0 ? "bg-emerald-500" : "bg-muted-foreground/40"
                  )}
                />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
