"use client";

import { useMemo } from "react";
import { Globe, Maximize2, MapPin as MapPinIcon } from "lucide-react";
import { WorldMap, type MapPin } from "@/components/admin/world-map";
import { useLiveSnapshot, useRelativeTime } from "@/lib/analytics/use-live";
import type { LiveSnapshot } from "@/lib/analytics/queries";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums tracking-tight",
          accent && "text-emerald-600 dark:text-emerald-500"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Panel({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
      <div className="mt-3">
        {empty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No data for this date range
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** Horizontal proportion bar used by the location and page breakdowns. */
function BreakdownRow({
  label,
  count,
  max,
  suffix,
}: {
  label: string;
  count: number;
  max: number;
  suffix?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-sm">{label}</p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-sky-500 transition-[width] duration-500"
            style={{ width: `${max ? (count / max) * 100 : 0}%` }}
          />
        </div>
      </div>
      <span className="text-sm font-medium tabular-nums">
        {count}
        {suffix}
      </span>
    </div>
  );
}

export function LiveView({ initial }: { initial: LiveSnapshot }) {
  const { snapshot, updatedAt } = useLiveSnapshot(initial);
  const relative = useRelativeTime(updatedAt);

  const pins = useMemo<MapPin[]>(
    () =>
      snapshot.visitors
        .filter((v) => v.latitude !== null && v.longitude !== null)
        .map((v) => ({
          id: v.id,
          latitude: v.latitude as number,
          longitude: v.longitude as number,
          kind: v.purchased ? ("order" as const) : ("visitor" as const),
          label:
            [v.city, v.country].filter(Boolean).join(", ") || "Unknown location",
        })),
    [snapshot.visitors]
  );

  const maxLocation = snapshot.byLocation[0]?.count ?? 0;
  const maxPage = snapshot.byPage[0]?.count ?? 0;
  const totalVisitors = snapshot.newVisitors + snapshot.returningVisitors;
  const peakMinute = Math.max(
    1,
    ...snapshot.sessionsPerMinute.map((m) => m.count)
  );

  return (
    <div data-full-bleed>
      <div className="flex items-center gap-2.5 px-4 py-4 md:px-8">
        <Globe className="size-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold tracking-tight">Live View</h1>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-500 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-sky-500" />
          </span>
          {relative}
        </span>
      </div>

      <div className="grid gap-4 px-4 pb-8 md:px-8 xl:grid-cols-[minmax(0,480px)_1fr]">
        {/* Left rail — the numbers. */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Tile
              label="Visitors right now"
              value={String(snapshot.visitorsRightNow)}
              accent={snapshot.visitorsRightNow > 0}
            />
            <Tile label="Total sales" value={formatMoney(snapshot.salesToday)} />
            <Tile label="Sessions" value={String(snapshot.sessionsToday)} />
            <Tile label="Orders" value={String(snapshot.ordersToday)} />
          </div>

          <Panel title="Customer behavior">
            <div className="grid grid-cols-3 divide-x">
              {[
                { label: "Active carts", value: snapshot.activeCarts },
                { label: "Checking out", value: snapshot.checkingOut },
                { label: "Purchased", value: snapshot.purchased },
              ].map((item, i) => (
                <div key={item.label} className={cn(i > 0 && "pl-4")}>
                  <p className="text-[13px] text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Sessions by location" empty={!snapshot.byLocation.length}>
            <div className="divide-y">
              {snapshot.byLocation.slice(0, 6).map((loc) => (
                <BreakdownRow
                  key={`${loc.label}-${loc.countryCode}`}
                  label={loc.label}
                  count={loc.count}
                  max={maxLocation}
                />
              ))}
            </div>
          </Panel>

          <Panel title="New vs returning customers" empty={totalVisitors === 0}>
            <div className="space-y-3">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-sky-500 transition-[width] duration-500"
                  style={{
                    width: `${(snapshot.newVisitors / (totalVisitors || 1)) * 100}%`,
                  }}
                />
                <div
                  className="bg-violet-500 transition-[width] duration-500"
                  style={{
                    width: `${(snapshot.returningVisitors / (totalVisitors || 1)) * 100}%`,
                  }}
                />
              </div>
              <div className="flex gap-5 text-sm">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-sky-500" />
                  New
                  <span className="font-medium tabular-nums">
                    {snapshot.newVisitors}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-violet-500" />
                  Returning
                  <span className="font-medium tabular-nums">
                    {snapshot.returningVisitors}
                  </span>
                </span>
              </div>
            </div>
          </Panel>

          <Panel title="Top landing pages" empty={!snapshot.byPage.length}>
            <div className="divide-y">
              {snapshot.byPage.map((page) => (
                <BreakdownRow
                  key={page.path}
                  label={page.path}
                  count={page.count}
                  max={maxPage}
                />
              ))}
            </div>
          </Panel>
        </div>

        {/* Right — the map. */}
        <div className="relative min-h-105 overflow-hidden rounded-xl border bg-linear-to-b from-sky-50 to-emerald-50/60 dark:from-sky-950/40 dark:to-emerald-950/20">
          <div className="absolute right-4 top-4 z-10 flex gap-2">
            <button
              type="button"
              className="cursor-pointer rounded-lg border bg-card/90 p-2 text-muted-foreground shadow-sm backdrop-blur transition-colors duration-150 hover:text-foreground"
              aria-label="Expand map"
            >
              <Maximize2 className="size-4" />
            </button>
          </div>

          <div className="flex h-full items-center justify-center p-6">
            <WorldMap pins={pins} className="h-auto w-full" />
          </div>

          {snapshot.visitorsRightNow === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
              <p className="flex items-center gap-2 rounded-full border bg-card/90 px-4 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur">
                <MapPinIcon className="size-3.5" />
                No visitors on the store right now
              </p>
            </div>
          )}

          {/* Sessions-per-minute strip, mirroring Shopify's activity ribbon. */}
          <div className="absolute inset-x-0 bottom-0 flex h-16 items-end gap-px border-t bg-card/70 px-3 pb-3 backdrop-blur">
            {snapshot.sessionsPerMinute.map((m) => (
              <div
                key={m.minute}
                className="flex-1 rounded-t-sm bg-sky-500/70"
                style={{
                  height: `${Math.max(2, (m.count / peakMinute) * 100)}%`,
                }}
                title={`${m.count} session${m.count === 1 ? "" : "s"}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
