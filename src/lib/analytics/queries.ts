import { createClient } from "@/lib/supabase/server";
import type { Order } from "@/lib/types";
import { getDashboard, type DashboardPoint } from "@/lib/analytics/dashboard";

/**
 * A session counts as live if it has been seen inside this window. The
 * storefront heartbeat is 20s, so 60s tolerates two missed beats before a
 * visitor drops off the count — long enough to avoid flicker on a slow
 * connection, short enough that the number still means "right now".
 */
const LIVE_WINDOW_SECONDS = 60;

export interface LiveVisitor {
  id: string;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  landingPath: string;
  deviceType: string;
  referrerHost: string;
  startedAt: string;
  isReturning: boolean;
  checkingOut: boolean;
  purchased: boolean;
}

export interface LiveSnapshot {
  visitorsRightNow: number;
  sessionsToday: number;
  ordersToday: number;
  salesToday: number;
  activeCarts: number;
  checkingOut: number;
  purchased: number;
  newVisitors: number;
  returningVisitors: number;
  visitors: LiveVisitor[];
  byLocation: { label: string; countryCode: string | null; count: number }[];
  byPage: { path: string; count: number }[];
  /** Per-minute session counts for the last hour, oldest first. */
  sessionsPerMinute: { minute: string; count: number }[];
  configured: boolean;
}

const EMPTY_SNAPSHOT: LiveSnapshot = {
  visitorsRightNow: 0,
  sessionsToday: 0,
  ordersToday: 0,
  salesToday: 0,
  activeCarts: 0,
  checkingOut: 0,
  purchased: 0,
  newVisitors: 0,
  returningVisitors: 0,
  visitors: [],
  byLocation: [],
  byPage: [],
  sessionsPerMinute: [],
  configured: false,
};

interface SessionRow {
  id: string;
  started_at: string;
  last_seen_at: string;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  landing_path: string;
  device_type: string;
  referrer_host: string;
  is_returning: boolean;
  checkout_started_at: string | null;
  purchased_at: string | null;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Everything the Live View and the Home visitor pill need, in one round trip
 * per table. Returns a zeroed snapshot rather than throwing when Supabase is
 * unreachable or the analytics migration has not been applied yet.
 */
export async function getLiveSnapshot(): Promise<LiveSnapshot> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return EMPTY_SNAPSHOT;

  try {
    const supabase = await createClient();
    const today = startOfToday();
    const liveCutoff = new Date(Date.now() - LIVE_WINDOW_SECONDS * 1000);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [sessionsRes, cartRes, ordersRes] = await Promise.all([
      // Today's sessions carry both the live slice and the daily totals, so one
      // fetch serves both rather than issuing a count query per tile.
      supabase
        .from("analytics_sessions")
        .select(
          "id, started_at, last_seen_at, city, region, country, country_code, latitude, longitude, landing_path, device_type, referrer_host, is_returning, checkout_started_at, purchased_at"
        )
        .gte("started_at", today.toISOString())
        .order("last_seen_at", { ascending: false })
        .limit(2000),
      // Cart adds in the last hour approximate "active carts" — we have no cart
      // table, so recency of intent is the honest proxy.
      supabase
        .from("analytics_events")
        .select("session_id")
        .eq("type", "add_to_cart")
        .gte("created_at", hourAgo.toISOString()),
      supabase
        .from("orders")
        .select("total, created_at")
        .eq("is_draft", false)
        .gte("created_at", today.toISOString()),
    ]);

    if (sessionsRes.error) return EMPTY_SNAPSHOT;

    const sessions = (sessionsRes.data ?? []) as SessionRow[];
    const live = sessions.filter(
      (s) => new Date(s.last_seen_at) >= liveCutoff
    );

    const orders = (ordersRes.data ?? []) as Pick<Order, "total" | "created_at">[];

    // Live sessions with a recent cart add, excluding those already further
    // down the funnel — the three funnel tiles should not double-count a visitor.
    const cartSessions = new Set(
      ((cartRes.data ?? []) as { session_id: string }[]).map((r) => r.session_id)
    );
    const checkingOut = live.filter((s) => s.checkout_started_at && !s.purchased_at);
    const purchased = live.filter((s) => s.purchased_at);
    const activeCarts = live.filter(
      (s) => cartSessions.has(s.id) && !s.checkout_started_at && !s.purchased_at
    );

    // Location rollup over live visitors, most populous first.
    const locationCounts = new Map<
      string,
      { label: string; countryCode: string | null; count: number }
    >();
    for (const s of live) {
      const label =
        [s.city, s.country].filter(Boolean).join(", ") || "Unknown location";
      const key = `${label}|${s.country_code ?? ""}`;
      const entry = locationCounts.get(key) ?? {
        label,
        countryCode: s.country_code,
        count: 0,
      };
      entry.count++;
      locationCounts.set(key, entry);
    }

    const pageCounts = new Map<string, number>();
    for (const s of live) {
      pageCounts.set(s.landing_path, (pageCounts.get(s.landing_path) ?? 0) + 1);
    }

    // Sixty one-minute buckets so the sparkline has a fixed x-axis even when
    // most minutes are empty.
    const perMinute: { minute: string; count: number }[] = [];
    const baseMinute = new Date(hourAgo);
    baseMinute.setSeconds(0, 0);
    for (let i = 0; i < 60; i++) {
      const at = new Date(baseMinute.getTime() + i * 60_000);
      perMinute.push({
        minute: at.toISOString(),
        count: 0,
      });
    }
    for (const s of sessions) {
      const idx = Math.floor(
        (new Date(s.started_at).getTime() - baseMinute.getTime()) / 60_000
      );
      if (idx >= 0 && idx < 60) perMinute[idx].count++;
    }

    return {
      visitorsRightNow: live.length,
      sessionsToday: sessions.length,
      ordersToday: orders.length,
      salesToday: orders.reduce((sum, o) => sum + Number(o.total), 0),
      activeCarts: activeCarts.length,
      checkingOut: checkingOut.length,
      purchased: purchased.length,
      newVisitors: live.filter((s) => !s.is_returning).length,
      returningVisitors: live.filter((s) => s.is_returning).length,
      visitors: live.map((s) => ({
        id: s.id,
        city: s.city,
        region: s.region,
        country: s.country,
        countryCode: s.country_code,
        latitude: s.latitude,
        longitude: s.longitude,
        landingPath: s.landing_path,
        deviceType: s.device_type,
        referrerHost: s.referrer_host,
        startedAt: s.started_at,
        isReturning: s.is_returning,
        checkingOut: Boolean(s.checkout_started_at) && !s.purchased_at,
        purchased: Boolean(s.purchased_at),
      })),
      byLocation: [...locationCounts.values()].sort((a, b) => b.count - a.count),
      byPage: [...pageCounts.entries()]
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      sessionsPerMinute: perMinute,
      configured: true,
    };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}


/* -------------------------------------------------------------------------- */
/* Sales aggregates                                                            */
/* -------------------------------------------------------------------------- */

export interface SalesTotals {
  grossSales: number;
  discounts: number;
  returns: number;
  netSales: number;
  shipping: number;
  taxes: number;
  totalSales: number;
  orders: number;
  ordersFulfilled: number;
  aov: number;
  sessions: number;
  conversionRate: number;
  returningCustomerRate: number;
}

export type SalesSeriesPoint = DashboardPoint;

export interface SalesBreakdown {
  totals: SalesTotals;
  previous: SalesTotals | null;
  series: SalesSeriesPoint[];
  previousSeries: SalesSeriesPoint[];
  byProduct: { name: string; revenue: number; units: number }[];
  byChannel: { name: string; revenue: number }[];
  currency: string;
  configured: boolean;
}

const ZERO_TOTALS: SalesTotals = {
  grossSales: 0,
  discounts: 0,
  returns: 0,
  netSales: 0,
  shipping: 0,
  taxes: 0,
  totalSales: 0,
  orders: 0,
  ordersFulfilled: 0,
  aov: 0,
  sessions: 0,
  conversionRate: 0,
  returningCustomerRate: 0,
};

/**
 * Sales for a window, optionally against the immediately preceding window of
 * equal length so every headline can show a delta.
 *
 * A view over `getDashboard` so the Home tiles and the Analytics page can never
 * disagree about what a sale is.
 */
export async function getSalesBreakdown(
  from: Date,
  to: Date,
  compare = false
): Promise<SalesBreakdown> {
  const dashboard = await getDashboard(from, to, compare ? "previous_period" : "none");
  const { current, previous } = dashboard;

  const pick = (t: typeof current.totals): SalesTotals => ({
    grossSales: t.grossSales,
    discounts: t.discounts,
    returns: t.reversals,
    netSales: t.netSales,
    shipping: t.shipping,
    taxes: t.taxes,
    totalSales: t.totalSales,
    orders: t.orders,
    ordersFulfilled: t.ordersFulfilled,
    aov: t.aov,
    sessions: t.sessions,
    conversionRate: t.conversionRate,
    returningCustomerRate: t.returningCustomerRate,
  });

  if (!dashboard.configured) {
    return {
      totals: ZERO_TOTALS,
      previous: null,
      series: [],
      previousSeries: [],
      byProduct: [],
      byChannel: [],
      currency: "INR",
      configured: false,
    };
  }

  return {
    totals: pick(current.totals),
    previous: previous ? pick(previous.totals) : null,
    series: current.series,
    previousSeries: previous?.series ?? [],
    byProduct: current.topProductsBySales.map((p) => ({
      name: p.name,
      revenue: p.revenue,
      units: p.units,
    })),
    // Single channel until POS or social selling actually writes orders.
    byChannel: [{ name: "Online Store", revenue: current.totals.totalSales }],
    currency: current.currency,
    configured: true,
  };
}
