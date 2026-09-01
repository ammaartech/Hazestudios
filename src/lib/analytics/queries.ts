import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/analytics/paginate";
import type { Order, OrderItem } from "@/lib/types";

/**
 * A session counts as live if it has been seen inside this window. The
 * storefront heartbeat is 20s, so 60s tolerates two missed beats before a
 * visitor drops off the count — long enough to avoid flicker on a slow
 * connection, short enough that the number still means "right now".
 */
export const LIVE_WINDOW_SECONDS = 60;

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

export interface SalesSeriesPoint {
  date: string;
  label: string;
  sales: number;
  orders: number;
  sessions: number;
  aov: number;
}

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

const isPaid = (status: string) =>
  status === "paid" || status === "partially_refunded";

/** Bucket width that keeps a chart readable across a day or three years. */
function bucketFor(from: Date, to: Date): "hour" | "day" | "week" | "month" {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 2) return "hour";
  if (days <= 90) return "day";
  if (days <= 730) return "week";
  return "month";
}

function bucketKey(date: Date, bucket: ReturnType<typeof bucketFor>) {
  const d = new Date(date);
  if (bucket === "hour") {
    d.setMinutes(0, 0, 0);
  } else if (bucket === "week") {
    d.setHours(0, 0, 0, 0);
    // Snap to Monday so week buckets line up with how merchants read a week.
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  } else if (bucket === "month") {
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

function bucketLabel(date: Date, bucket: ReturnType<typeof bucketFor>) {
  if (bucket === "hour") {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(date);
  }
  if (bucket === "month") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * The only order columns these aggregates read. `select("*")` also drags three
 * jsonb blobs (both addresses and utm) plus the note and referrer text across
 * the wire for every order in the window, none of which is ever looked at.
 */
const SALES_ORDER_COLUMNS =
  "created_at, total, subtotal, discount_total, payment_status, fulfillment_status, currency, order_items(title_snapshot, price_snapshot, quantity)";

interface OrderRow
  extends Pick<
    Order,
    | "created_at"
    | "total"
    | "subtotal"
    | "discount_total"
    | "payment_status"
    | "fulfillment_status"
    | "currency"
  > {
  order_items?: Pick<OrderItem, "title_snapshot" | "price_snapshot" | "quantity">[];
}

interface SessionRollupRow {
  started_at: string;
  is_returning: boolean;
}

async function totalsFor(
  from: Date,
  to: Date
): Promise<{ totals: SalesTotals; series: SalesSeriesPoint[]; orders: OrderRow[] }> {
  const supabase = await createClient();

  const [orders, sessions] = await Promise.all([
    // Paged, and ordered by id after created_at: two orders can share a
    // timestamp, and a non-unique sort lets them swap across a page boundary.
    fetchAllPages<OrderRow>((start, end) =>
      supabase
        .from("orders")
        .select(SALES_ORDER_COLUMNS)
        .eq("is_draft", false)
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString())
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(start, end)
    ),
    // Missing table (migration not applied) must not blank out the sales
    // numbers, so sessions degrade to zero instead of failing the whole read.
    fetchAllPages<SessionRollupRow>((start, end) =>
      supabase
        .from("analytics_sessions")
        .select("started_at, is_returning")
        .gte("started_at", from.toISOString())
        .lte("started_at", to.toISOString())
        .order("started_at", { ascending: true })
        .order("id", { ascending: true })
        .range(start, end)
    ).catch(() => [] as SessionRollupRow[]),
  ]);

  const paidOrders = orders.filter((o) => isPaid(o.payment_status));
  const grossSales = paidOrders.reduce((s, o) => s + Number(o.subtotal), 0);
  const discounts = paidOrders.reduce((s, o) => s + Number(o.discount_total), 0);
  const totalSales = paidOrders.reduce((s, o) => s + Number(o.total), 0);
  const netSales = grossSales - discounts;
  // The schema has no shipping or tax columns, so whatever the order total
  // carries beyond net sales is reported as tax rather than invented.
  const taxes = Math.max(0, totalSales - netSales);

  const returningSessions = sessions.filter((s) => s.is_returning).length;

  const bucket = bucketFor(from, to);
  const buckets = new Map<number, SalesSeriesPoint>();

  // Pre-seed every bucket so gaps render as zero instead of collapsing the axis.
  for (
    let cursor = bucketKey(from, bucket);
    cursor <= to;
    cursor = (() => {
      const next = new Date(cursor);
      if (bucket === "hour") next.setHours(next.getHours() + 1);
      else if (bucket === "day") next.setDate(next.getDate() + 1);
      else if (bucket === "week") next.setDate(next.getDate() + 7);
      else next.setMonth(next.getMonth() + 1);
      return next;
    })()
  ) {
    buckets.set(cursor.getTime(), {
      date: cursor.toISOString(),
      label: bucketLabel(cursor, bucket),
      sales: 0,
      orders: 0,
      sessions: 0,
      aov: 0,
    });
  }

  for (const o of orders) {
    const key = bucketKey(new Date(o.created_at), bucket).getTime();
    const point = buckets.get(key);
    if (!point) continue;
    point.orders++;
    if (isPaid(o.payment_status)) point.sales += Number(o.total);
  }

  for (const s of sessions) {
    const key = bucketKey(new Date(s.started_at), bucket).getTime();
    const point = buckets.get(key);
    if (point) point.sessions++;
  }

  const series = [...buckets.values()].map((p) => ({
    ...p,
    aov: p.orders ? p.sales / p.orders : 0,
  }));

  return {
    orders,
    series,
    totals: {
      grossSales,
      discounts,
      returns: 0,
      netSales,
      shipping: 0,
      taxes,
      totalSales,
      orders: orders.length,
      ordersFulfilled: orders.filter((o) => o.fulfillment_status === "fulfilled")
        .length,
      aov: paidOrders.length ? totalSales / paidOrders.length : 0,
      sessions: sessions.length,
      conversionRate: sessions.length
        ? (paidOrders.length / sessions.length) * 100
        : 0,
      returningCustomerRate: sessions.length
        ? (returningSessions / sessions.length) * 100
        : 0,
    },
  };
}

/**
 * Sales for a window, optionally against the immediately preceding window of
 * equal length so every headline can show a delta.
 */
export async function getSalesBreakdown(
  from: Date,
  to: Date,
  compare = false
): Promise<SalesBreakdown> {
  const empty: SalesBreakdown = {
    totals: ZERO_TOTALS,
    previous: null,
    series: [],
    previousSeries: [],
    byProduct: [],
    byChannel: [],
    currency: "INR",
    configured: false,
  };

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return empty;

  try {
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);
    const prevTo = new Date(from.getTime() - 1);

    const [current, previous] = await Promise.all([
      totalsFor(from, to),
      compare ? totalsFor(prevFrom, prevTo) : Promise.resolve(null),
    ]);

    const revenueByProduct = new Map<string, { revenue: number; units: number }>();
    for (const order of current.orders) {
      if (!isPaid(order.payment_status)) continue;
      for (const item of order.order_items ?? []) {
        const entry = revenueByProduct.get(item.title_snapshot) ?? {
          revenue: 0,
          units: 0,
        };
        entry.revenue += Number(item.price_snapshot) * item.quantity;
        entry.units += item.quantity;
        revenueByProduct.set(item.title_snapshot, entry);
      }
    }

    return {
      totals: current.totals,
      previous: previous?.totals ?? null,
      series: current.series,
      previousSeries: previous?.series ?? [],
      byProduct: [...revenueByProduct.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10),
      // Single channel until POS or social selling actually writes orders.
      byChannel: [{ name: "Online Store", revenue: current.totals.totalSales }],
      currency: current.orders[0]?.currency ?? "INR",
      configured: true,
    };
  } catch {
    return empty;
  }
}
