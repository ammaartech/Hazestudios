#!/usr/bin/env node
/**
 * Seeds removable demo sales data, so the reporting screens have something to
 * report on.
 *
 *   npm run seed:demo          # insert
 *   npm run seed:demo:clean    # remove, leaving real data untouched
 *   npm run seed:demo -- --reset
 *
 * The store's schema was complete but `orders` and `order_items` were empty,
 * which makes every sales, finance and customer report correct and blank at the
 * same time — the least useful state for checking whether a report is right.
 *
 * Everything written here carries a marker so it can be removed exactly:
 *
 *   customers          tags contains 'demo-seed'
 *   orders             note = 'demo-seed'      (order_items/refunds cascade)
 *   analytics_sessions session_key like 'demo-seed-%'  (events cascade)
 *
 * Real rows are never modified except `customers.orders_count`/`total_spent`,
 * which are rollups on the demo customers themselves. Existing products are
 * read, never written — order lines copy the title and price into their
 * snapshot columns, which is what the schema wants anyway.
 *
 * The generator is seeded, so a re-run produces the same store.
 */
import pg from "pg";
import { dbConfig, describeTarget } from "./db-config.mjs";

const MARKER = "demo-seed";
const args = process.argv.slice(2);
const wantsClean = args.includes("--clean");
const wantsReset = args.includes("--reset");

/* -------------------------------------------------------------------------- */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** mulberry32 — a fixed seed keeps re-runs reproducible, so a number in a report
 *  can be checked twice. */
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20260725);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
/** Weighted pick from [[value, weight], ...]. */
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let roll = rand() * total;
  for (const [value, w] of pairs) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

/** A timestamp `daysAgo` days back, at a plausible shopping hour. */
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(between(8, 22), between(0, 59), between(0, 59), 0);
  return d;
}

/**
 * Bulk INSERT with placeholders, since a few hundred single round trips over the
 * session pooler is the slow part of this script.
 */
async function insertMany(client, table, columns, rows, returning = "") {
  if (!rows.length) return [];
  const values = [];
  const params = [];
  let n = 1;
  for (const row of rows) {
    values.push(`(${row.map(() => `$${n++}`).join(", ")})`);
    params.push(...row);
  }
  const sql = `insert into ${table} (${columns.join(", ")}) values ${values.join(", ")}${
    returning ? ` returning ${returning}` : ""
  }`;
  const { rows: out } = await client.query(sql, params);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Demo content                                                                */
/* -------------------------------------------------------------------------- */

const PEOPLE = [
  ["Amara", "Osei"], ["Devon", "Reyes"], ["Priya", "Raman"], ["Tomas", "Lindqvist"],
  ["Yuki", "Tanaka"], ["Noor", "Haddad"], ["Elena", "Petrova"], ["Marcus", "Bell"],
  ["Sofia", "Marchetti"], ["Kwame", "Boateng"], ["Hannah", "Whitfield"],
  ["Ravi", "Chandran"], ["Ines", "Duarte"], ["Oliver", "Novak"],
];

const CITIES = [
  ["Toronto", "Ontario", "Canada", "CA", 43.65, -79.38],
  ["Vancouver", "British Columbia", "Canada", "CA", 49.28, -123.12],
  ["New York", "New York", "United States", "US", 40.71, -74.01],
  ["Chicago", "Illinois", "United States", "US", 41.88, -87.63],
  ["London", "England", "United Kingdom", "GB", 51.51, -0.13],
  ["Berlin", "Berlin", "Germany", "DE", 52.52, 13.4],
  ["Sydney", "New South Wales", "Australia", "AU", -33.87, 151.21],
  ["Mumbai", "Maharashtra", "India", "IN", 19.08, 72.88],
];

const REFERRERS = [
  ["", ""],
  ["https://www.google.com/", "www.google.com"],
  ["https://www.instagram.com/", "www.instagram.com"],
  ["https://t.co/", "t.co"],
  ["https://www.reddit.com/", "www.reddit.com"],
];

const DISCOUNTS = ["WELCOME10", "SUMMER20", "FREESHIP", "VIP15"];
const SEARCHES = ["hoodie", "tee", "black jacket", "cargo", "size chart", "sale"];

/* -------------------------------------------------------------------------- */
/* Clean                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every statement carries a WHERE clause. The database has pg_safeupdate on, so
 * a bare DELETE is rejected outright — which is the behaviour we want here
 * anyway, since real orders live in these same tables.
 */
async function clean(client) {
  const events = await client.query(
    `delete from analytics_events
      where session_id in (select id from analytics_sessions where session_key like $1)`,
    [`${MARKER}-%`]
  );
  const sessions = await client.query(
    `delete from analytics_sessions where session_key like $1`,
    [`${MARKER}-%`]
  );
  // order_items, refunds and fulfillments are ON DELETE CASCADE from orders.
  const orders = await client.query(`delete from orders where note = $1`, [MARKER]);
  const customers = await client.query(
    `delete from customers where $1 = any(tags)`,
    [MARKER]
  );

  return {
    events: events.rowCount,
    sessions: sessions.rowCount,
    orders: orders.rowCount,
    customers: customers.rowCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                        */
/* -------------------------------------------------------------------------- */

async function seed(client) {
  const { rows: products } = await client.query(
    `select id, title, price from products where status = 'active' order by title`
  );
  if (!products.length) throw new Error("no active products to build orders from");

  const { rows: settings } = await client.query(
    `select currency from shop_settings limit 1`
  );
  const currency = settings[0]?.currency ?? "USD";

  const { rows: locations } = await client.query(
    `select id from locations order by is_default desc limit 1`
  );
  const locationId = locations[0]?.id ?? null;

  /* -- Customers ---------------------------------------------------------- */
  const customers = await insertMany(
    client,
    "customers",
    ["first_name", "last_name", "email", "phone", "tags", "accepts_marketing", "created_at"],
    PEOPLE.map(([first, last], i) => [
      first,
      last,
      `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
      `+1416555${String(1000 + i)}`,
      [MARKER],
      rand() > 0.5,
      daysAgo(between(120, 240)),
    ]),
    "id"
  );

  /* -- Orders ------------------------------------------------------------- */
  // 180 days of history: enough for "last 12 months", "last 90 days" and a
  // specific window like 1 June to today all to return something.
  const HORIZON = 180;
  const ORDER_COUNT = 170;

  const orderRows = [];
  const orderPlans = [];

  for (let i = 0; i < ORDER_COUNT; i++) {
    // Skewed toward recent days, the way a growing store actually looks.
    const age = Math.floor(HORIZON * Math.pow(rand(), 1.6));
    const createdAt = daysAgo(age);

    // A handful of unfinished drafts, so the `is_draft = false` convention in
    // the report prompt is genuinely load-bearing and can be checked.
    const isDraft = rand() < 0.05;

    const paymentStatus = isDraft
      ? "pending"
      : weighted([
          ["paid", 70],
          ["pending", 12],
          ["partially_refunded", 10],
          ["refunded", 8],
        ]);

    // Build the line items first — the order totals are derived from them.
    const lines = [];
    const lineCount = weighted([[1, 45], [2, 30], [3, 17], [4, 8]]);
    const chosen = new Set();
    for (let l = 0; l < lineCount; l++) {
      const product = pick(products);
      if (chosen.has(product.id)) continue;
      chosen.add(product.id);
      lines.push({
        product,
        quantity: weighted([[1, 70], [2, 20], [3, 7], [4, 3]]),
      });
    }

    const subtotal = lines.reduce(
      (sum, l) => sum + Number(l.product.price) * l.quantity,
      0
    );
    const discountCode = rand() < 0.25 ? pick(DISCOUNTS) : null;
    const discountTotal = discountCode
      ? Math.round(subtotal * (discountCode === "VIP15" ? 0.15 : 0.1) * 100) / 100
      : 0;
    const total = Math.round((subtotal - discountTotal) * 100) / 100;

    const fulfillmentStatus =
      paymentStatus === "paid" || paymentStatus === "partially_refunded"
        ? weighted([["fulfilled", 65], ["partial", 15], ["unfulfilled", 20]])
        : "unfulfilled";

    // Most orders belong to a customer; some are guest checkouts, which is what
    // makes the left join in a "sales by customer" report matter.
    const customerId = rand() < 0.85 ? pick(customers).id : null;

    orderRows.push([
      customerId,
      isDraft,
      paymentStatus,
      fulfillmentStatus,
      subtotal,
      discountTotal,
      discountCode,
      total,
      currency,
      MARKER,
      locationId,
      createdAt,
      fulfillmentStatus === "fulfilled" ? createdAt : null,
    ]);
    orderPlans.push({ lines, paymentStatus, total, createdAt, customerId, fulfillmentStatus });
  }

  const orders = await insertMany(
    client,
    "orders",
    [
      "customer_id", "is_draft", "payment_status", "fulfillment_status",
      "subtotal", "discount_total", "discount_code", "total", "currency",
      "note", "location_id", "created_at", "closed_at",
    ],
    orderRows,
    "id"
  );

  /* -- Order items -------------------------------------------------------- */
  const itemRows = [];
  orders.forEach((order, i) => {
    for (const line of orderPlans[i].lines) {
      itemRows.push([
        order.id,
        line.product.id,
        // Snapshots, not joins: the report prompt tells the model to read these
        // because a deleted product nulls product_id.
        line.product.title,
        "",
        line.product.price,
        line.quantity,
      ]);
    }
  });
  await insertMany(
    client,
    "order_items",
    ["order_id", "product_id", "title_snapshot", "variant_snapshot", "price_snapshot", "quantity"],
    itemRows
  );

  /* -- Refunds and fulfillments ------------------------------------------- */
  const refundRows = [];
  const fulfillmentRows = [];
  orders.forEach((order, i) => {
    const plan = orderPlans[i];
    if (plan.paymentStatus === "refunded") {
      refundRows.push([order.id, plan.total, pick(["Customer changed mind", "Damaged in transit", "Wrong size"]), true, plan.createdAt]);
    } else if (plan.paymentStatus === "partially_refunded") {
      const amount = Math.round(plan.total * (rand() < 0.5 ? 0.3 : 0.5) * 100) / 100;
      refundRows.push([order.id, amount, pick(["Partial return", "Price adjustment"]), false, plan.createdAt]);
    }
    if (plan.fulfillmentStatus !== "unfulfilled") {
      fulfillmentRows.push([
        order.id,
        `1Z${between(100000, 999999)}${between(100, 999)}`,
        pick(["UPS", "Canada Post", "DHL", "FedEx"]),
        plan.fulfillmentStatus === "fulfilled" ? "fulfilled" : "partial",
        plan.createdAt,
      ]);
    }
  });
  await insertMany(client, "refunds", ["order_id", "amount", "reason", "restock", "created_at"], refundRows);
  await insertMany(
    client,
    "fulfillments",
    ["order_id", "tracking_number", "carrier", "status", "created_at"],
    fulfillmentRows
  );

  /* -- Customer rollups --------------------------------------------------- */
  // `top-customers` reads these columns rather than aggregating orders, so they
  // have to agree with the orders just written.
  await client.query(
    `update customers cu
        set orders_count = coalesce(agg.n, 0),
            total_spent  = coalesce(agg.spent, 0)
       from (select o.customer_id,
                    count(*)::int as n,
                    sum(o.total)  as spent
               from orders o
              where o.note = $1
                and o.is_draft = false
                and o.payment_status in ('paid', 'partially_refunded')
              group by o.customer_id) agg
      where agg.customer_id = cu.id
        and $1 = any(cu.tags)`,
    [MARKER]
  );

  /* -- Analytics ---------------------------------------------------------- */
  // Traffic is what turns conversion rate and "sessions by referrer" from an
  // empty table into a number worth checking. Only the last 60 days, matching
  // how the storefront beacon would actually have behaved.
  // Only paid orders can be attributed to a converting session.
  const paidOrders = orders.filter((_, i) => orderPlans[i].paymentStatus === "paid");

  const sessionRows = [];
  const SESSION_COUNT = 420;
  for (let i = 0; i < SESSION_COUNT; i++) {
    const age = Math.floor(60 * Math.pow(rand(), 1.4));
    const startedAt = daysAgo(age);
    const [city, region, country, code, lat, lon] = pick(CITIES);
    const [referrer, referrerHost] = pick(REFERRERS);
    const pageViews = between(1, 9);
    const converted = rand() < 0.06;
    const startedCheckout = converted || rand() < 0.12;

    const lastSeen = new Date(startedAt.getTime() + between(30, 1800) * 1000);

    sessionRows.push([
      `${MARKER}-${i}-${Math.floor(rand() * 1e9)}`,
      startedAt,
      lastSeen,
      country, code, region, city, lat, lon,
      referrer,
      referrerHost,
      pick(["/", "/", "/collections/all", "/products", "/cart"]),
      weighted([["desktop", 45], ["mobile", 48], ["tablet", 7]]),
      "Mozilla/5.0 (demo-seed)",
      pageViews,
      rand() < 0.35,
      converted && paidOrders.length ? pick(paidOrders).id : null,
      startedCheckout ? lastSeen : null,
      converted ? lastSeen : null,
    ]);
  }

  const sessions = await insertMany(
    client,
    "analytics_sessions",
    [
      "session_key", "started_at", "last_seen_at",
      "country", "country_code", "region", "city", "latitude", "longitude",
      "referrer", "referrer_host", "landing_path", "device_type", "user_agent",
      "page_views", "is_returning", "order_id", "checkout_started_at", "purchased_at",
    ],
    sessionRows,
    "id, started_at, page_views, purchased_at"
  );

  const eventRows = [];
  for (const session of sessions) {
    const base = new Date(session.started_at);
    let offset = 0;
    const step = () => new Date(base.getTime() + (offset += between(10, 120)) * 1000);

    eventRows.push([session.id, "page_view", "/", null, "", "", 0, step()]);

    for (let v = 0; v < Math.min(session.page_views, 6); v++) {
      const product = pick(products);
      eventRows.push([
        session.id,
        "product_view",
        `/products/${product.id}`,
        product.id,
        product.title,
        "",
        0,
        step(),
      ]);
    }

    if (rand() < 0.3) {
      eventRows.push([session.id, "search", "/search", null, "", pick(SEARCHES), 0, step()]);
    }
    if (rand() < 0.25) {
      const product = pick(products);
      eventRows.push([
        session.id, "add_to_cart", "/cart", product.id, product.title, "",
        Number(product.price), step(),
      ]);
    }
    if (session.purchased_at) {
      eventRows.push([session.id, "checkout_start", "/checkout", null, "", "", 0, step()]);
      eventRows.push([session.id, "purchase", "/checkout/done", null, "", "", between(40, 600), step()]);
    }
  }

  await insertMany(
    client,
    "analytics_events",
    ["session_id", "type", "path", "product_id", "product_title", "search_query", "value", "created_at"],
    eventRows
  );

  return {
    customers: customers.length,
    orders: orders.length,
    items: itemRows.length,
    refunds: refundRows.length,
    fulfillments: fulfillmentRows.length,
    sessions: sessions.length,
    events: eventRows.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

const config = dbConfig();
console.log(c.dim(`target  ${describeTarget(config)}`));

const client = new pg.Client(config);
await client.connect();

try {
  const { rows: existing } = await client.query(
    `select count(*)::int as n from orders where note = $1`,
    [MARKER]
  );
  const hasDemo = existing[0].n > 0;

  if (wantsClean || wantsReset) {
    if (!hasDemo && wantsClean) {
      console.log(c.yellow("No demo data found — nothing to remove."));
    } else {
      await client.query("begin");
      const removed = await clean(client);
      await client.query("commit");
      console.log(
        c.green("removed  ") +
          `${removed.orders} orders, ${removed.customers} customers, ` +
          `${removed.sessions} sessions, ${removed.events} events`
      );
    }
    if (wantsClean) process.exit(0);
  } else if (hasDemo) {
    console.log(
      c.red(`\nDemo data is already present (${existing[0].n} orders).\n`) +
        "  npm run seed:demo:clean   remove it\n" +
        "  npm run seed:demo -- --reset   replace it\n"
    );
    process.exit(1);
  }

  await client.query("begin");
  const counts = await seed(client);
  await client.query("commit");

  console.log(
    c.green("inserted ") +
      `${counts.orders} orders · ${counts.items} line items · ` +
      `${counts.customers} customers · ${counts.refunds} refunds · ` +
      `${counts.fulfillments} fulfillments · ${counts.sessions} sessions · ` +
      `${counts.events} events`
  );

  // Print what a report should now be able to find, so the numbers on screen
  // have something to be checked against.
  const { rows: summary } = await client.query(`
    select to_char(min(o.created_at), 'YYYY-MM-DD') as first_order,
           to_char(max(o.created_at), 'YYYY-MM-DD') as last_order,
           count(*) filter (where o.is_draft) ::int  as drafts,
           count(*) filter (where not o.is_draft and o.payment_status in ('paid','partially_refunded'))::int as paid,
           round(sum(o.total) filter (where not o.is_draft and o.payment_status in ('paid','partially_refunded')), 2) as revenue
      from orders o
     where o.note = $1`,
    [MARKER]
  );
  const s = summary[0];
  console.log(
    c.dim(
      `\n  ${s.first_order} → ${s.last_order} · ${s.paid} paid orders · ` +
        `${s.drafts} drafts · ${s.revenue} gross`
    )
  );

  const { rows: top } = await client.query(`
    select oi.title_snapshot as product,
           sum(oi.quantity)::int as units,
           round(sum(oi.price_snapshot * oi.quantity), 2) as revenue
      from order_items oi
      join orders o on o.id = oi.order_id
     where o.note = $1
       and o.is_draft = false
       and o.payment_status in ('paid', 'partially_refunded')
       and o.created_at >= date '2026-06-01'
     group by 1 order by units desc limit 3`,
    [MARKER]
  );
  if (top.length) {
    console.log(c.dim("\n  Top sellers since 2026-06-01 (what the AI report should show):"));
    for (const row of top) {
      console.log(c.dim(`    ${row.product} — ${row.units} units, ${row.revenue}`));
    }
  }
  console.log();
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(c.red(`\nFailed: ${error.message}\n`));
  process.exitCode = 1;
} finally {
  await client.end();
}
