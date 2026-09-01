import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { findReport } from "@/lib/analytics/report-definitions";
import { fetchAllPages } from "@/lib/analytics/paginate";
import type { Customer, Order, OrderItem, Product } from "@/lib/types";

/**
 * Query runners for the report catalog. Server-only — this module reaches for
 * the cookie-scoped Supabase client, so the catalog UI imports its definitions
 * from `report-definitions.ts` instead.
 */

export interface ReportResult {
  headers: string[];
  rows: (string | number)[][];
  /** Charted when present — label/value pairs in row order. */
  chart?: { label: string; value: number }[];
  chartKind?: "line" | "bar";
  money?: boolean;
  summary?: { label: string; value: string }[];
}

/* -------------------------------------------------------------------------- */
/* Runners                                                                     */
/* -------------------------------------------------------------------------- */

const isPaid = (status: string) =>
  status === "paid" || status === "partially_refunded";

/** Ordered day buckets so a gap renders as zero instead of vanishing. */
function dayBuckets(from: Date, to: Date) {
  const days: { key: string; label: string }[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= to) {
    days.push({
      key: cursor.toDateString(),
      label: formatDate(cursor),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function rank<T>(
  map: Map<string, T>,
  by: (value: T) => number
): [string, T][] {
  return [...map.entries()].sort((a, b) => by(b[1]) - by(a[1]));
}

const EMPTY: ReportResult = { headers: [], rows: [] };

/** Bucket for orders carrying no shipping city — kept out of city rankings. */
const NO_CITY = "No shipping address";

/**
 * Tidy a hand-typed city for display: "pune" becomes "Pune".
 *
 * Only all-lowercase words are touched, so an acronym a customer typed in caps
 * ("NCR") survives instead of being flattened to "Ncr". Cosmetic — the grouping
 * key is lowercased separately, so this cannot split or merge a row.
 */
function titleCase(value: string) {
  return value.replace(/\S+/g, (word) =>
    word === word.toLowerCase()
      ? word.charAt(0).toUpperCase() + word.slice(1)
      : word
  );
}

/** Every non-draft order in the window, drained a page at a time. */
function fetchOrders<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  columns: string,
  fromIso: string,
  toIso: string
): Promise<T[]> {
  return fetchAllPages<T>((start, end) =>
    supabase
      .from("orders")
      .select(columns)
      .eq("is_draft", false)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      // Without a stable sort the pages are free to overlap or skip rows.
      .order("created_at", { ascending: true })
      .range(start, end)
  );
}

export async function runReport(
  slug: string,
  from: Date,
  to: Date
): Promise<ReportResult> {
  const definition = findReport(slug);
  if (!definition || !process.env.NEXT_PUBLIC_SUPABASE_URL) return EMPTY;

  try {
    const supabase = await createClient();
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    switch (slug) {
      /* ----------------------------------------------------- Orders ------ */
      case "total-orders": {
        const orders = await fetchOrders<
          Pick<Order, "created_at" | "total" | "payment_status" | "cancelled_at">
        >(
          supabase,
          "created_at, total, payment_status, cancelled_at",
          fromIso,
          toIso
        );

        const stats = new Map<
          string,
          { orders: number; paid: number; sales: number }
        >();
        let paidOrders = 0;
        let cancelled = 0;
        let sales = 0;

        for (const o of orders) {
          const key = new Date(o.created_at).toDateString();
          const cur = stats.get(key) ?? { orders: 0, paid: 0, sales: 0 };
          cur.orders += 1;
          if (o.cancelled_at) cancelled += 1;
          if (isPaid(o.payment_status)) {
            cur.paid += 1;
            cur.sales += Number(o.total);
            paidOrders += 1;
            sales += Number(o.total);
          }
          stats.set(key, cur);
        }

        const buckets = dayBuckets(from, to);
        return {
          headers: ["Date", "Orders", "Paid orders", "Gross sales"],
          rows: buckets.map((b) => {
            const s = stats.get(b.key) ?? { orders: 0, paid: 0, sales: 0 };
            return [b.label, s.orders, s.paid, formatMoney(s.sales)];
          }),
          chart: buckets.map((b) => ({
            label: b.label,
            value: stats.get(b.key)?.orders ?? 0,
          })),
          chartKind: "line",
          // The plotted series is a count of orders, not a sum of money.
          money: false,
          summary: [
            { label: "Total orders", value: String(orders.length) },
            { label: "Paid orders", value: String(paidOrders) },
            { label: "Cancelled", value: String(cancelled) },
            { label: "Gross sales", value: formatMoney(sales) },
          ],
        };
      }

      case "orders-by-city": {
        const orders = await fetchOrders<
          Pick<Order, "total" | "payment_status" | "shipping_address">
        >(supabase, "total, payment_status, shipping_address", fromIso, toIso);

        const stats = new Map<
          string,
          { label: string; orders: number; paid: number; sales: number }
        >();

        for (const o of orders) {
          const address = o.shipping_address ?? {};
          const city = titleCase((address.city ?? "").trim());
          const province = (address.province ?? "").trim();
          // Imported and hand-keyed orders disagree on case ("Mumbai" vs
          // "mumbai"), which would otherwise split one city across two rows.
          // The first spelling seen becomes the label for the merged group.
          // Named rather than "Unknown": these are overwhelmingly orders keyed
          // in through the admin, which carry no shipping address at all — a
          // fact about how the order was taken, not a gap in the data.
          const label = city
            ? province
              ? `${city}, ${province}`
              : city
            : NO_CITY;
          const key = label.toLowerCase();

          const cur = stats.get(key) ?? {
            label,
            orders: 0,
            paid: 0,
            sales: 0,
          };
          cur.orders += 1;
          if (isPaid(o.payment_status)) {
            cur.paid += 1;
            cur.sales += Number(o.total);
          }
          stats.set(key, cur);
        }

        const ranked = rank(stats, (v) => v.orders);
        const named = ranked.filter(([, v]) => v.label !== NO_CITY);

        return {
          headers: ["City", "Orders", "Paid orders", "Gross sales"],
          rows: ranked.map(([, v]) => [
            v.label,
            v.orders,
            v.paid,
            formatMoney(v.sales),
          ]),
          chart: named
            .slice(0, 10)
            .map(([, v]) => ({ label: v.label, value: v.orders })),
          chartKind: "bar",
          money: false,
          summary: [
            { label: "Total orders", value: String(orders.length) },
            { label: "Cities", value: String(named.length) },
            {
              label: "Top city",
              value: named.length
                ? `${named[0][1].label} · ${named[0][1].orders}`
                : "—",
            },
          ],
        };
      }

      /* ------------------------------------------------ Acquisition ------ */
      case "sessions-over-time": {
        const { data } = await supabase
          .from("analytics_sessions")
          .select("started_at")
          .gte("started_at", fromIso)
          .lte("started_at", toIso);

        const counts = new Map<string, number>();
        for (const s of (data ?? []) as { started_at: string }[]) {
          const key = new Date(s.started_at).toDateString();
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const buckets = dayBuckets(from, to);

        return {
          headers: ["Date", "Sessions"],
          rows: buckets.map((b) => [b.label, counts.get(b.key) ?? 0]),
          chart: buckets.map((b) => ({
            label: b.label,
            value: counts.get(b.key) ?? 0,
          })),
          chartKind: "line",
        };
      }

      case "sessions-by-location": {
        const { data } = await supabase
          .from("analytics_sessions")
          .select("city, region, country")
          .gte("started_at", fromIso)
          .lte("started_at", toIso);

        const counts = new Map<string, number>();
        for (const s of (data ?? []) as {
          city: string | null;
          region: string | null;
          country: string | null;
        }[]) {
          const key =
            [s.city, s.region, s.country].filter(Boolean).join(", ") ||
            "Unknown";
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }

        const ranked = rank(counts, (v) => v);
        return {
          headers: ["Location", "Sessions"],
          rows: ranked.map(([k, v]) => [k, v]),
          chart: ranked.slice(0, 10).map(([k, v]) => ({ label: k, value: v })),
          chartKind: "bar",
        };
      }

      case "sessions-by-referrer": {
        const { data } = await supabase
          .from("analytics_sessions")
          .select("referrer_host")
          .gte("started_at", fromIso)
          .lte("started_at", toIso);

        const counts = new Map<string, number>();
        for (const s of (data ?? []) as { referrer_host: string }[]) {
          // No referrer host means the visitor typed the URL or came from a
          // privacy-stripping source — "Direct" is the honest label.
          const key = s.referrer_host || "Direct / none";
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }

        const ranked = rank(counts, (v) => v);
        return {
          headers: ["Referrer", "Sessions"],
          rows: ranked.map(([k, v]) => [k, v]),
          chart: ranked.slice(0, 10).map(([k, v]) => ({ label: k, value: v })),
          chartKind: "bar",
        };
      }

      case "sessions-by-device": {
        const { data } = await supabase
          .from("analytics_sessions")
          .select("device_type")
          .gte("started_at", fromIso)
          .lte("started_at", toIso);

        const counts = new Map<string, number>();
        for (const s of (data ?? []) as { device_type: string }[]) {
          counts.set(s.device_type, (counts.get(s.device_type) ?? 0) + 1);
        }
        const total = [...counts.values()].reduce((a, b) => a + b, 0);
        const ranked = rank(counts, (v) => v);

        return {
          headers: ["Device type", "Sessions", "Share"],
          rows: ranked.map(([k, v]) => [
            k,
            v,
            total ? `${((v / total) * 100).toFixed(1)}%` : "0%",
          ]),
          chart: ranked.map(([k, v]) => ({ label: k, value: v })),
          chartKind: "bar",
        };
      }

      /* ---------------------------------------------------- Behavior ----- */
      case "sessions-by-landing-page": {
        const { data } = await supabase
          .from("analytics_sessions")
          .select("landing_path")
          .gte("started_at", fromIso)
          .lte("started_at", toIso);

        const counts = new Map<string, number>();
        for (const s of (data ?? []) as { landing_path: string }[]) {
          counts.set(s.landing_path, (counts.get(s.landing_path) ?? 0) + 1);
        }
        const ranked = rank(counts, (v) => v);

        return {
          headers: ["Landing page", "Sessions"],
          rows: ranked.map(([k, v]) => [k, v]),
          chart: ranked.slice(0, 10).map(([k, v]) => ({ label: k, value: v })),
          chartKind: "bar",
        };
      }

      case "conversion-rate-over-time": {
        const [sessionsRes, ordersRes] = await Promise.all([
          supabase
            .from("analytics_sessions")
            .select("started_at")
            .gte("started_at", fromIso)
            .lte("started_at", toIso),
          supabase
            .from("orders")
            .select("created_at, payment_status")
            .eq("is_draft", false)
            .gte("created_at", fromIso)
            .lte("created_at", toIso),
        ]);

        const sessions = new Map<string, number>();
        for (const s of (sessionsRes.data ?? []) as { started_at: string }[]) {
          const key = new Date(s.started_at).toDateString();
          sessions.set(key, (sessions.get(key) ?? 0) + 1);
        }
        const orders = new Map<string, number>();
        for (const o of (ordersRes.data ?? []) as Pick<
          Order,
          "created_at" | "payment_status"
        >[]) {
          if (!isPaid(o.payment_status)) continue;
          const key = new Date(o.created_at).toDateString();
          orders.set(key, (orders.get(key) ?? 0) + 1);
        }

        const buckets = dayBuckets(from, to);
        const rate = (key: string) => {
          const s = sessions.get(key) ?? 0;
          return s ? ((orders.get(key) ?? 0) / s) * 100 : 0;
        };

        return {
          headers: ["Date", "Sessions", "Orders", "Conversion rate"],
          rows: buckets.map((b) => [
            b.label,
            sessions.get(b.key) ?? 0,
            orders.get(b.key) ?? 0,
            `${rate(b.key).toFixed(2)}%`,
          ]),
          chart: buckets.map((b) => ({ label: b.label, value: rate(b.key) })),
          chartKind: "line",
        };
      }

      case "products-viewed": {
        const { data } = await supabase
          .from("analytics_events")
          .select("product_title")
          .eq("type", "product_view")
          .gte("created_at", fromIso)
          .lte("created_at", toIso);

        const counts = new Map<string, number>();
        for (const e of (data ?? []) as { product_title: string }[]) {
          if (!e.product_title) continue;
          counts.set(e.product_title, (counts.get(e.product_title) ?? 0) + 1);
        }
        const ranked = rank(counts, (v) => v);

        return {
          headers: ["Product", "Views"],
          rows: ranked.map(([k, v]) => [k, v]),
          chart: ranked.slice(0, 10).map(([k, v]) => ({ label: k, value: v })),
          chartKind: "bar",
        };
      }

      case "searches-by-query": {
        const { data } = await supabase
          .from("analytics_events")
          .select("search_query")
          .eq("type", "search")
          .gte("created_at", fromIso)
          .lte("created_at", toIso);

        const counts = new Map<string, number>();
        for (const e of (data ?? []) as { search_query: string }[]) {
          if (!e.search_query) continue;
          counts.set(e.search_query, (counts.get(e.search_query) ?? 0) + 1);
        }
        const ranked = rank(counts, (v) => v);

        return {
          headers: ["Search term", "Searches"],
          rows: ranked.map(([k, v]) => [k, v]),
          chart: ranked.slice(0, 10).map(([k, v]) => ({ label: k, value: v })),
          chartKind: "bar",
        };
      }

      /* ------------------------------------------------------- Sales ----- */
      case "sales-over-time": {
        const { data } = await supabase
          .from("orders")
          .select("created_at, total, payment_status")
          .eq("is_draft", false)
          .gte("created_at", fromIso)
          .lte("created_at", toIso);

        const stats = new Map<string, { orders: number; sales: number }>();
        for (const o of (data ?? []) as Pick<
          Order,
          "created_at" | "total" | "payment_status"
        >[]) {
          const key = new Date(o.created_at).toDateString();
          const cur = stats.get(key) ?? { orders: 0, sales: 0 };
          cur.orders += 1;
          if (isPaid(o.payment_status)) cur.sales += Number(o.total);
          stats.set(key, cur);
        }

        const buckets = dayBuckets(from, to);
        return {
          headers: ["Date", "Orders", "Gross sales"],
          rows: buckets.map((b) => {
            const s = stats.get(b.key) ?? { orders: 0, sales: 0 };
            return [b.label, s.orders, formatMoney(s.sales)];
          }),
          chart: buckets.map((b) => ({
            label: b.label,
            value: stats.get(b.key)?.sales ?? 0,
          })),
          chartKind: "line",
          money: true,
        };
      }

      case "sales-by-product": {
        const { data } = await supabase
          .from("order_items")
          .select("title_snapshot, price_snapshot, quantity, orders!inner(created_at, payment_status, is_draft)")
          .eq("orders.is_draft", false)
          .gte("orders.created_at", fromIso)
          .lte("orders.created_at", toIso);

        const stats = new Map<string, { units: number; revenue: number }>();
        // Without generated database types, the client infers embedded
        // relations as arrays. `orders` is a to-one join here and arrives as a
        // single object, so the cast goes through `unknown`.
        const items = (data ?? []) as unknown as (Pick<
          OrderItem,
          "title_snapshot" | "price_snapshot" | "quantity"
        > & { orders: { payment_status: string } })[];

        for (const item of items) {
          if (!isPaid(item.orders.payment_status)) continue;
          const cur = stats.get(item.title_snapshot) ?? { units: 0, revenue: 0 };
          cur.units += item.quantity;
          cur.revenue += Number(item.price_snapshot) * item.quantity;
          stats.set(item.title_snapshot, cur);
        }

        const ranked = rank(stats, (v) => v.revenue);
        return {
          headers: ["Product", "Units sold", "Revenue"],
          rows: ranked.map(([k, v]) => [k, v.units, formatMoney(v.revenue)]),
          chart: ranked
            .slice(0, 10)
            .map(([k, v]) => ({ label: k, value: v.revenue })),
          chartKind: "bar",
          money: true,
        };
      }

      case "sales-by-customer": {
        const { data } = await supabase
          .from("orders")
          .select("total, payment_status, customers(first_name, last_name, email)")
          .eq("is_draft", false)
          .gte("created_at", fromIso)
          .lte("created_at", toIso);

        const stats = new Map<string, { orders: number; total: number }>();
        // As above — `customers` is a to-one embed returned as an object.
        const rows = (data ?? []) as unknown as (Pick<
          Order,
          "total" | "payment_status"
        > & {
          customers: Pick<Customer, "first_name" | "last_name" | "email"> | null;
        })[];

        for (const o of rows) {
          if (!isPaid(o.payment_status)) continue;
          const name = o.customers
            ? `${o.customers.first_name} ${o.customers.last_name}`.trim() ||
              o.customers.email ||
              "Unknown"
            : "No customer";
          const cur = stats.get(name) ?? { orders: 0, total: 0 };
          cur.orders += 1;
          cur.total += Number(o.total);
          stats.set(name, cur);
        }

        const ranked = rank(stats, (v) => v.total);
        return {
          headers: ["Customer", "Orders", "Total spent"],
          rows: ranked.map(([k, v]) => [k, v.orders, formatMoney(v.total)]),
          chart: ranked
            .slice(0, 10)
            .map(([k, v]) => ({ label: k, value: v.total })),
          chartKind: "bar",
          money: true,
        };
      }

      case "average-order-value": {
        const { data } = await supabase
          .from("orders")
          .select("created_at, total, payment_status")
          .eq("is_draft", false)
          .gte("created_at", fromIso)
          .lte("created_at", toIso);

        const stats = new Map<string, { orders: number; sales: number }>();
        for (const o of (data ?? []) as Pick<
          Order,
          "created_at" | "total" | "payment_status"
        >[]) {
          if (!isPaid(o.payment_status)) continue;
          const key = new Date(o.created_at).toDateString();
          const cur = stats.get(key) ?? { orders: 0, sales: 0 };
          cur.orders += 1;
          cur.sales += Number(o.total);
          stats.set(key, cur);
        }

        const buckets = dayBuckets(from, to);
        const aov = (key: string) => {
          const s = stats.get(key);
          return s && s.orders ? s.sales / s.orders : 0;
        };

        return {
          headers: ["Date", "Paid orders", "Average order value"],
          rows: buckets.map((b) => [
            b.label,
            stats.get(b.key)?.orders ?? 0,
            formatMoney(aov(b.key)),
          ]),
          chart: buckets.map((b) => ({ label: b.label, value: aov(b.key) })),
          chartKind: "line",
          money: true,
        };
      }

      /* --------------------------------------------------- Customers ----- */
      case "customers-over-time": {
        const { data } = await supabase
          .from("customers")
          .select("created_at")
          .gte("created_at", fromIso)
          .lte("created_at", toIso);

        const counts = new Map<string, number>();
        for (const c of (data ?? []) as Pick<Customer, "created_at">[]) {
          const key = new Date(c.created_at).toDateString();
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }

        const buckets = dayBuckets(from, to);
        return {
          headers: ["Date", "New customers"],
          rows: buckets.map((b) => [b.label, counts.get(b.key) ?? 0]),
          chart: buckets.map((b) => ({
            label: b.label,
            value: counts.get(b.key) ?? 0,
          })),
          chartKind: "line",
        };
      }

      case "top-customers": {
        // Lifetime figures, so this one deliberately ignores the date range.
        const { data } = await supabase
          .from("customers")
          .select("first_name, last_name, email, orders_count, total_spent")
          .order("total_spent", { ascending: false })
          .limit(50);

        const rows = ((data ?? []) as Pick<
          Customer,
          "first_name" | "last_name" | "email" | "orders_count" | "total_spent"
        >[]).map((c) => [
          `${c.first_name} ${c.last_name}`.trim() || c.email || "Unknown",
          c.email ?? "—",
          c.orders_count,
          formatMoney(Number(c.total_spent)),
        ]);

        return {
          headers: ["Customer", "Email", "Orders", "Lifetime spend"],
          rows,
          chart: ((data ?? []) as Pick<
            Customer,
            "first_name" | "last_name" | "email" | "total_spent"
          >[])
            .slice(0, 10)
            .map((c) => ({
              label:
                `${c.first_name} ${c.last_name}`.trim() || c.email || "Unknown",
              value: Number(c.total_spent),
            })),
          chartKind: "bar",
          money: true,
        };
      }

      case "new-vs-returning": {
        const { data } = await supabase
          .from("analytics_sessions")
          .select("is_returning")
          .gte("started_at", fromIso)
          .lte("started_at", toIso);

        const sessions = (data ?? []) as { is_returning: boolean }[];
        const returning = sessions.filter((s) => s.is_returning).length;
        const fresh = sessions.length - returning;
        const share = (n: number) =>
          sessions.length ? `${((n / sessions.length) * 100).toFixed(1)}%` : "0%";

        return {
          headers: ["Visitor type", "Sessions", "Share"],
          rows: [
            ["New", fresh, share(fresh)],
            ["Returning", returning, share(returning)],
          ],
          chart: [
            { label: "New", value: fresh },
            { label: "Returning", value: returning },
          ],
          chartKind: "bar",
        };
      }

      /* --------------------------------------------------- Inventory ----- */
      case "inventory-on-hand":
      case "low-stock": {
        const { data } = await supabase
          .from("products")
          .select("id, title, sku, track_inventory, inventory_levels(quantity)")
          .order("title");

        type Row = Pick<Product, "id" | "title" | "sku" | "track_inventory"> & {
          inventory_levels: { quantity: number }[];
        };

        const rows = ((data ?? []) as Row[])
          .filter((p) => p.track_inventory)
          .map((p) => ({
            title: p.title,
            sku: p.sku || "—",
            // Stock is per location; the report shows the total across them.
            quantity: (p.inventory_levels ?? []).reduce(
              (sum, l) => sum + Number(l.quantity),
              0
            ),
          }));

        const filtered =
          slug === "low-stock" ? rows.filter((r) => r.quantity <= 10) : rows;
        const sorted = [...filtered].sort((a, b) => a.quantity - b.quantity);

        return {
          headers: ["Product", "SKU", "Quantity on hand"],
          rows: sorted.map((r) => [r.title, r.sku, r.quantity]),
          chart: sorted.slice(0, 10).map((r) => ({
            label: r.title,
            value: r.quantity,
          })),
          chartKind: "bar",
        };
      }

      /* ---------------------------------------------------- Finances ----- */
      case "payment-status": {
        const { data } = await supabase
          .from("orders")
          .select("payment_status, total")
          .eq("is_draft", false)
          .gte("created_at", fromIso)
          .lte("created_at", toIso);

        const stats = new Map<string, { orders: number; total: number }>();
        for (const o of (data ?? []) as Pick<
          Order,
          "payment_status" | "total"
        >[]) {
          const key = o.payment_status.replace(/_/g, " ");
          const cur = stats.get(key) ?? { orders: 0, total: 0 };
          cur.orders += 1;
          cur.total += Number(o.total);
          stats.set(key, cur);
        }

        const ranked = rank(stats, (v) => v.total);
        return {
          headers: ["Payment status", "Orders", "Total value"],
          rows: ranked.map(([k, v]) => [k, v.orders, formatMoney(v.total)]),
          chart: ranked.map(([k, v]) => ({ label: k, value: v.total })),
          chartKind: "bar",
          money: true,
        };
      }

      case "discount-usage": {
        const { data } = await supabase
          .from("orders")
          .select("discount_code, discount_total, total")
          .eq("is_draft", false)
          .gte("created_at", fromIso)
          .lte("created_at", toIso);

        const stats = new Map<string, { orders: number; discounted: number }>();
        for (const o of (data ?? []) as Pick<
          Order,
          "discount_code" | "discount_total"
        >[]) {
          if (!o.discount_code) continue;
          const cur = stats.get(o.discount_code) ?? { orders: 0, discounted: 0 };
          cur.orders += 1;
          cur.discounted += Number(o.discount_total);
          stats.set(o.discount_code, cur);
        }

        const ranked = rank(stats, (v) => v.discounted);
        return {
          headers: ["Discount code", "Orders", "Total discounted"],
          rows: ranked.map(([k, v]) => [k, v.orders, formatMoney(v.discounted)]),
          chart: ranked
            .slice(0, 10)
            .map(([k, v]) => ({ label: k, value: v.discounted })),
          chartKind: "bar",
          money: true,
        };
      }

      default:
        return EMPTY;
    }
  } catch {
    // A missing table or a dropped connection shows an empty report, not a 500.
    return EMPTY;
  }
}
