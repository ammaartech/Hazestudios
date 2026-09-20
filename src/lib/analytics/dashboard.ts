import { cacheLife, cacheTag, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/analytics/paginate";
import {
  bucketFor,
  bucketKey,
  seedBuckets,
  type Bucket,
} from "@/lib/analytics/buckets";
import { compareWindow, type CompareMode } from "@/lib/analytics/ranges";
import type { Order, OrderItem } from "@/lib/types";

/**
 * Everything the Analytics dashboard shows, aggregated once per window.
 *
 * The money follows Shopify's sales report, because the ledger in `orders`
 * *is* a Shopify export and the merchant reads these numbers against the ones
 * Shopify still shows them. Its model is a ledger, not a filter: every order
 * is booked as a sale on the day it is placed, and money that comes back is
 * booked as a *reversal* on the day it comes back.
 *
 *   gross sales      Σ line-item price × quantity, before any discount, for
 *                    every order placed in the window — cancelled ones too
 *   discounts        Σ discount_total + prepaid_discount
 *   sales reversals  merchandise value of orders cancelled in the window, plus
 *                    refunds booked in the window on orders that still stand
 *   net sales        gross − discounts − reversals
 *   total sales      net + shipping + additional fees + taxes
 *
 * A cancelled order therefore shows up twice — as a sale when placed and as a
 * reversal when cancelled — which is exactly how the merchant's Shopify
 * dashboard shows it, and is what lets a month read honestly when an order
 * placed in it is cancelled the next. Cancelling also takes the order's
 * shipping, fees and tax back out of their own lines, so those read net, the
 * way Shopify's do.
 */

export interface DashboardTotals {
  grossSales: number;
  discounts: number;
  reversals: number;
  netSales: number;
  shipping: number;
  fees: number;
  returnFees: number;
  taxes: number;
  totalSales: number;
  /** Every non-draft order placed in the window, cancelled ones included. */
  orders: number;
  /** Orders placed in the window that still stand — the AOV denominator. */
  saleOrders: number;
  ordersFulfilled: number;
  aov: number;
  sessions: number;
  conversionRate: number;
  /** Share of orders (with an identifiable customer) from a repeat customer. */
  returningCustomerRate: number;
}

export interface DashboardPoint {
  date: string;
  label: string;
  tick: string;
  sales: number;
  orders: number;
  sessions: number;
  aov: number;
  conversionRate: number;
  returningCustomerRate: number;
}

export interface Funnel {
  sessions: number;
  addedToCart: number;
  reachedCheckout: number;
  completed: number;
}

export interface ProductRow {
  name: string;
  revenue: number;
  units: number;
  orders: number;
  /** Units on orders that were later refunded, voided or cancelled. */
  reversedUnits: number;
}

export interface NamedCount {
  name: string;
  value: number;
}

export interface DashboardWindow {
  totals: DashboardTotals;
  series: DashboardPoint[];
  funnel: Funnel;
  byReferrer: NamedCount[];
  byLocation: NamedCount[];
  byDevice: NamedCount[];
  /** Top products by revenue. */
  topProductsBySales: ProductRow[];
  /** Top products by units ordered. */
  topProductsByUnits: ProductRow[];
  currency: string;
}

export interface Dashboard {
  current: DashboardWindow;
  previous: DashboardWindow | null;
  bucket: Bucket;
  configured: boolean;
}

const ZERO_TOTALS: DashboardTotals = {
  grossSales: 0,
  discounts: 0,
  reversals: 0,
  netSales: 0,
  shipping: 0,
  fees: 0,
  returnFees: 0,
  taxes: 0,
  totalSales: 0,
  orders: 0,
  saleOrders: 0,
  ordersFulfilled: 0,
  aov: 0,
  sessions: 0,
  conversionRate: 0,
  returningCustomerRate: 0,
};

const EMPTY_WINDOW: DashboardWindow = {
  totals: ZERO_TOTALS,
  series: [],
  funnel: { sessions: 0, addedToCart: 0, reachedCheckout: 0, completed: 0 },
  byReferrer: [],
  byLocation: [],
  byDevice: [],
  topProductsBySales: [],
  topProductsByUnits: [],
  currency: "INR",
};

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The only order columns the dashboard reads. `select("*")` would also drag both
 * address blobs, utm and the note across the wire for every order in the window.
 */
const ORDER_COLUMNS =
  "id, created_at, email, customer_id, subtotal, discount_total, prepaid_discount, cod_fee, shipping_total, tax_total, total, payment_status, fulfillment_status, cancelled_at, currency, order_items(title_snapshot, price_snapshot, quantity)";

interface OrderRow
  extends Pick<
    Order,
    | "id"
    | "created_at"
    | "email"
    | "customer_id"
    | "subtotal"
    | "discount_total"
    | "prepaid_discount"
    | "cod_fee"
    | "shipping_total"
    | "tax_total"
    | "total"
    | "payment_status"
    | "fulfillment_status"
    | "cancelled_at"
    | "currency"
  > {
  order_items?: Pick<OrderItem, "title_snapshot" | "price_snapshot" | "quantity">[];
}

interface RefundRow {
  amount: number;
  created_at: string;
  /** The parent order, so a refund on a cancelled order is not booked twice. */
  orders: Pick<Order, "cancelled_at" | "payment_status"> | null;
}

/** An order cancelled inside the window, whatever day it was placed. */
interface CancelledRow
  extends Pick<
    Order,
    | "id"
    | "cancelled_at"
    | "subtotal"
    | "discount_total"
    | "prepaid_discount"
    | "shipping_total"
    | "cod_fee"
    | "tax_total"
  > {
  order_items?: Pick<OrderItem, "price_snapshot" | "quantity">[];
}

interface SessionRow {
  id: string;
  started_at: string;
  is_returning: boolean;
  referrer_host: string;
  country: string | null;
  device_type: string;
  checkout_started_at: string | null;
  purchased_at: string | null;
}

/**
 * An order whose goods came back or never went out: cancelled, refunded in
 * full, or authorised and voided (almost all COD orders the customer cancelled
 * before dispatch — the export marks those voided, sometimes without a
 * cancellation date).
 */
function isReversed(o: Pick<Order, "payment_status" | "cancelled_at">) {
  return (
    o.payment_status === "refunded" ||
    o.payment_status === "voided" ||
    Boolean(o.cancelled_at)
  );
}

function grossOf(o: {
  subtotal: number;
  discount_total: number;
  order_items?: Pick<OrderItem, "price_snapshot" | "quantity">[];
}) {
  const items = o.order_items ?? [];
  if (items.length === 0) {
    // No line items survived (a hand-keyed admin order); the pre-discount
    // subtotal is the closest thing to gross we have.
    return Number(o.subtotal) + Number(o.discount_total);
  }
  return items.reduce((s, i) => s + Number(i.price_snapshot) * i.quantity, 0);
}

/** What a cancellation reverses: the merchandise, net of its discounts. */
function merchandiseOf(o: {
  subtotal: number;
  discount_total: number;
  prepaid_discount: number;
  order_items?: Pick<OrderItem, "price_snapshot" | "quantity">[];
}) {
  return grossOf(o) - Number(o.discount_total) - Number(o.prepaid_discount);
}

function customerKey(o: OrderRow) {
  const email = (o.email ?? "").trim().toLowerCase();
  return email || o.customer_id || null;
}

/**
 * Which of these customers had ordered before the window opened. Looked up in
 * chunks by email so a 30-day window costs one small query and an all-time
 * window costs a few dozen empty ones — either beats scanning the whole ledger.
 */
async function customersSeenBefore(
  supabase: Db,
  emails: string[],
  before: Date
): Promise<Set<string>> {
  const seen = new Set<string>();
  const CHUNK = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < emails.length; i += CHUNK) {
    chunks.push(emails.slice(i, i + CHUNK));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const rows = await fetchAllPages<{ email: string }>((start, end) =>
        supabase
          .from("orders")
          .select("email")
          .eq("is_draft", false)
          .lt("created_at", before.toISOString())
          .in("email", chunk)
          .order("id", { ascending: true })
          .range(start, end)
      );
      for (const r of rows) seen.add(r.email.trim().toLowerCase());
    })
  );

  return seen;
}

function topCounts(counts: Map<string, number>, limit: number): NamedCount[] {
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* One window                                                                  */
/* -------------------------------------------------------------------------- */

/** Either client works: the cookie-scoped one under RLS, or the service role from inside a cache. */
type Db = Awaited<ReturnType<typeof createClient>> | NonNullable<ReturnType<typeof createAdminClient>>;

async function loadWindow(
  supabase: Db,
  from: Date,
  to: Date,
  bucket: Bucket
): Promise<DashboardWindow> {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const [orders, cancelled, refunds, sessions, cartSessions] = await Promise.all([
    // Paged, and ordered by id after created_at: two orders can share a
    // timestamp, and a non-unique sort lets them swap across a page boundary.
    fetchAllPages<OrderRow>((start, end) =>
      supabase
        .from("orders")
        .select(ORDER_COLUMNS)
        .eq("is_draft", false)
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(start, end)
    ),
    // Cancellations are booked on the cancellation date, so this is a second
    // pass over orders keyed on cancelled_at rather than created_at.
    fetchAllPages<CancelledRow>((start, end) =>
      supabase
        .from("orders")
        .select(
          "id, cancelled_at, subtotal, discount_total, prepaid_discount, shipping_total, cod_fee, tax_total, order_items(price_snapshot, quantity)"
        )
        .eq("is_draft", false)
        .gte("cancelled_at", fromIso)
        .lte("cancelled_at", toIso)
        .order("cancelled_at", { ascending: true })
        .order("id", { ascending: true })
        .range(start, end)
    ),
    fetchAllPages<RefundRow>((start, end) =>
      supabase
        .from("refunds")
        .select("amount, created_at, orders(cancelled_at, payment_status)")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(start, end)
    ),
    // A missing analytics table (migration not applied) must not blank out the
    // sales numbers, so sessions degrade to zero instead of failing the read.
    fetchAllPages<SessionRow>((start, end) =>
      supabase
        .from("analytics_sessions")
        .select(
          "id, started_at, is_returning, referrer_host, country, device_type, checkout_started_at, purchased_at"
        )
        .gte("started_at", fromIso)
        .lte("started_at", toIso)
        .order("started_at", { ascending: true })
        .order("id", { ascending: true })
        .range(start, end)
    ).catch(() => [] as SessionRow[]),
    fetchAllPages<{ session_id: string }>((start, end) =>
      supabase
        .from("analytics_events")
        .select("session_id")
        .eq("type", "add_to_cart")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("id", { ascending: true })
        .range(start, end)
    )
      .then((rows) => new Set(rows.map((r) => r.session_id)))
      .catch(() => new Set<string>()),
  ]);

  /* ---- Returning customers ---------------------------------------------- */

  const emailsInWindow = [
    ...new Set(
      orders
        .map((o) => (o.email ?? "").trim().toLowerCase())
        .filter((e) => e.length > 0)
    ),
  ];
  const seenBefore = await customersSeenBefore(supabase, emailsInWindow, from);

  /* ---- Buckets ---------------------------------------------------------- */

  const points = new Map<
    number,
    DashboardPoint & { saleOrders: number; identified: number; returning: number }
  >();
  for (const seed of seedBuckets(from, to, bucket)) {
    points.set(new Date(seed.date).getTime(), {
      ...seed,
      sales: 0,
      orders: 0,
      sessions: 0,
      aov: 0,
      conversionRate: 0,
      returningCustomerRate: 0,
      saleOrders: 0,
      identified: 0,
      returning: 0,
    });
  }
  const pointFor = (iso: string) =>
    points.get(bucketKey(new Date(iso), bucket).getTime());

  /* ---- Orders ----------------------------------------------------------- */

  const totals = { ...ZERO_TOTALS };
  const products = new Map<string, ProductRow>();
  // Orders in the window are walked oldest first, so a customer's second order
  // this month is "returning" even when their first was also this month.
  const seenInWindow = new Set<string>();
  let identifiedOrders = 0;
  let returningOrders = 0;

  // Money coming back, booked in the bucket of the day it came back. A refund
  // is one number; a cancellation unwinds each line of the order.
  const reverseRefund = (amount: number, at: string) => {
    totals.reversals += amount;
    const point = pointFor(at);
    if (point) point.sales -= amount;
  };
  const reverseOrder = (
    o: Omit<CancelledRow, "id" | "cancelled_at">,
    at: string
  ) => {
    const merchandise = merchandiseOf(o);
    const shipping = Number(o.shipping_total);
    const fees = Number(o.cod_fee);
    const taxes = Number(o.tax_total);
    totals.reversals += merchandise;
    totals.shipping -= shipping;
    totals.fees -= fees;
    totals.taxes -= taxes;
    const point = pointFor(at);
    if (point) point.sales -= merchandise + shipping + fees + taxes;
  };

  for (const o of orders) {
    const point = pointFor(o.created_at);
    totals.orders++;
    if (o.fulfillment_status === "fulfilled") totals.ordersFulfilled++;
    if (point) point.orders++;

    const key = customerKey(o);
    if (key) {
      identifiedOrders++;
      const returning = seenBefore.has(key) || seenInWindow.has(key);
      if (returning) returningOrders++;
      seenInWindow.add(key);
      if (point) {
        point.identified++;
        if (returning) point.returning++;
      }
    }

    const reversed = isReversed(o);
    for (const item of o.order_items ?? []) {
      const row = products.get(item.title_snapshot) ?? {
        name: item.title_snapshot,
        revenue: 0,
        units: 0,
        orders: 0,
        reversedUnits: 0,
      };
      row.units += item.quantity;
      row.orders++;
      if (reversed) row.reversedUnits += item.quantity;
      else row.revenue += Number(item.price_snapshot) * item.quantity;
      products.set(item.title_snapshot, row);
    }

    const gross = grossOf(o);
    const discounts = Number(o.discount_total) + Number(o.prepaid_discount);
    const shipping = Number(o.shipping_total);
    const fees = Number(o.cod_fee);
    const taxes = Number(o.tax_total);
    const sale = gross - discounts + shipping + fees + taxes;

    if (!reversed) totals.saleOrders++;
    totals.grossSales += gross;
    totals.discounts += discounts;
    totals.shipping += shipping;
    totals.fees += fees;
    totals.taxes += taxes;
    if (point) {
      if (!reversed) point.saleOrders++;
      point.sales += sale;
    }

    // Voided with no cancellation date: the export never said when, so the
    // reversal is booked against the order itself.
    if (o.payment_status === "voided" && !o.cancelled_at) {
      reverseOrder(o, o.created_at);
    }
  }

  /* ---- Reversals -------------------------------------------------------- */

  for (const c of cancelled) {
    reverseOrder(c, c.cancelled_at!);
  }

  for (const r of refunds) {
    // A refund on a cancelled or voided order is the same money the
    // cancellation already reversed.
    if (r.orders && isReversed(r.orders)) continue;
    reverseRefund(Number(r.amount), r.created_at);
  }

  totals.netSales = totals.grossSales - totals.discounts - totals.reversals;
  totals.totalSales =
    totals.netSales + totals.shipping + totals.fees + totals.returnFees + totals.taxes;
  totals.aov = totals.saleOrders ? totals.totalSales / totals.saleOrders : 0;
  totals.returningCustomerRate = identifiedOrders
    ? (returningOrders / identifiedOrders) * 100
    : 0;

  /* ---- Sessions --------------------------------------------------------- */

  const referrers = new Map<string, number>();
  const locations = new Map<string, number>();
  const devices = new Map<string, number>();
  const funnel: Funnel = {
    sessions: sessions.length,
    addedToCart: 0,
    reachedCheckout: 0,
    completed: 0,
  };

  for (const s of sessions) {
    const point = pointFor(s.started_at);
    if (point) point.sessions++;

    const referrer = s.referrer_host || "Direct";
    referrers.set(referrer, (referrers.get(referrer) ?? 0) + 1);
    const location = s.country || "Unknown";
    locations.set(location, (locations.get(location) ?? 0) + 1);
    const device = s.device_type || "desktop";
    devices.set(device, (devices.get(device) ?? 0) + 1);

    if (s.purchased_at) {
      funnel.completed++;
      funnel.reachedCheckout++;
      funnel.addedToCart++;
    } else if (s.checkout_started_at) {
      funnel.reachedCheckout++;
      funnel.addedToCart++;
    } else if (cartSessions.has(s.id)) {
      funnel.addedToCart++;
    }
  }

  totals.sessions = sessions.length;
  totals.conversionRate = sessions.length
    ? (funnel.completed / sessions.length) * 100
    : 0;

  const series: DashboardPoint[] = [...points.values()].map(
    ({ saleOrders, identified, returning, ...p }) => ({
      ...p,
      aov: saleOrders ? p.sales / saleOrders : 0,
      conversionRate: p.sessions ? (p.orders / p.sessions) * 100 : 0,
      returningCustomerRate: identified ? (returning / identified) * 100 : 0,
    })
  );

  const productRows = [...products.values()];

  return {
    totals,
    series,
    funnel,
    byReferrer: topCounts(referrers, 10),
    byLocation: topCounts(locations, 10),
    byDevice: topCounts(devices, 5),
    topProductsBySales: [...productRows]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
    topProductsByUnits: [...productRows]
      .sort((a, b) => b.units - a.units)
      .slice(0, 10),
    currency: orders[0]?.currency ?? "INR",
  };
}

/* -------------------------------------------------------------------------- */

/** Cache tag for everything aggregated from orders; expired by order-writing actions. */
export const ORDERS_TAG = "orders";

/**
 * An admin action changed an order — payment, fulfilment, refund, cancel —
 * so the cached dashboard aggregates are one write behind. Server Actions
 * only (`updateTag` throws elsewhere); orders that arrive from checkout rely
 * on the `dashboard` profile's minute instead.
 */
export function revalidateOrders(): void {
  updateTag(ORDERS_TAG);
}

async function aggregate(
  supabase: Db,
  from: Date,
  to: Date,
  compare: CompareMode
): Promise<Dashboard> {
  const bucket = bucketFor(from, to);
  const prev = compareWindow(from, to, compare);
  const [current, previous] = await Promise.all([
    loadWindow(supabase, from, to, bucket),
    prev ? loadWindow(supabase, prev.from, prev.to, bucket) : Promise.resolve(null),
  ]);
  return { current, previous, bucket, configured: true };
}

/**
 * The cached aggregation. Keyed by the window's ISO bounds and the comparison
 * mode; shared across staff and instances through the remote handler, and
 * expired by `ORDERS_TAG` when an admin action touches an order. The
 * `dashboard` profile bounds staleness for orders that arrive from checkout
 * and webhooks, which never pass through a Server Action.
 *
 * Reads through the service role because a cached function cannot see the
 * request's cookies. Returns null when that key is absent so the caller can
 * fall back to a direct read under RLS.
 */
async function cachedDashboard(
  fromIso: string,
  toIso: string,
  compare: CompareMode
): Promise<Dashboard | null> {
  "use cache: remote";
  cacheLife("dashboard");
  cacheTag(ORDERS_TAG);
  const db = createAdminClient();
  if (!db) return null;
  return aggregate(db, new Date(fromIso), new Date(toIso), compare);
}

/**
 * Snap a "now" endpoint to the minute. A rolling preset ends at the request's
 * own timestamp, which would make every cache key unique; the `dashboard`
 * profile promises a minute of freshness anyway, so the minute is the key.
 */
function quantiseEnd(to: Date) {
  // A closed window already ends on a boundary (23:59:59.999); keep it so the
  // last day's orders stay inside.
  if (to.getSeconds() === 59 && to.getMilliseconds() === 999) return to;
  const d = new Date(to);
  d.setSeconds(0, 0);
  return d;
}

/**
 * The dashboard for a window, optionally with a comparison window aggregated
 * the same way. Returns zeroes rather than throwing when Supabase is not
 * configured or unreachable — an empty dashboard is recoverable, a 500 is not.
 */
export async function getDashboard(
  from: Date,
  to: Date,
  compare: CompareMode = "none"
): Promise<Dashboard> {
  const bucket = bucketFor(from, to);
  const empty: Dashboard = {
    current: EMPTY_WINDOW,
    previous: null,
    bucket,
    configured: false,
  };

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return empty;

  try {
    const cached = await cachedDashboard(
      from.toISOString(),
      quantiseEnd(to).toISOString(),
      compare
    );
    if (cached) return cached;
    return await aggregate(await createClient(), from, to, compare);
  } catch {
    return empty;
  }
}
