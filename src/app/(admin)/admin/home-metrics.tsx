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
            ? "text-emerald-600 dark:text-emerald-500"
            : "text-rose-600 dark:text-rose-500")
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
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b px-4 py-3.5 md:px-8">
      <div className="min-w-36">
        <p className="text-[13px] font-medium">All channels</p>
        <p className="text-[13px] text-muted-foreground">{rangeLabel}</p>
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-x-8 gap-y-4">
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
      </div>

      <div className="ml-auto text-right">
        <p className="text-[13px] text-muted-foreground">Live visitors</p>
        <div className="mt-0.5 flex items-center justify-end gap-2">
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
  );
}
