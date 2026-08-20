#!/usr/bin/env node
/**
 * Imports a Shopify orders export (orders_export_*.csv) into orders,
 * order_items, customers, refunds and fulfillments.
 *
 *   node scripts/import-orders.mjs <path-to-csv> [--dry]
 *
 * The export is one row per line item: the first row of an order carries every
 * order-level column, continuation rows repeat only Name/Id and the Lineitem
 * columns. Rows are grouped by the export's `Id` (Shopify's numeric order id)
 * rather than `Name`, because exchange orders can reuse a name.
 *
 * Idempotency: orders carry `order_name` (unique where not null, from 0017).
 * An order whose name already exists in the database is skipped, so re-running
 * the import after a partial failure only fills the gap. Where the export
 * itself reuses a name (exchange orders), later duplicates get a `_2`, `_3`…
 * suffix so both rows can exist.
 *
 * Line items are matched back to the catalogue by variant SKU first, then
 * product SKU, then product title (the part of `Lineitem name` before the last
 * " - "). A line that matches nothing still imports — title/price/quantity are
 * snapshots by design — it just carries null product/variant ids.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { dbConfig, describeTarget } from "./db-config.mjs";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const csvPath = args.find((a) => !a.startsWith("--"));
if (!csvPath) {
  console.error("usage: node scripts/import-orders.mjs <csv> [--dry]");
  process.exit(1);
}

/* ----------------------------------------------------------------------- */
/* CSV                                                                      */
/* ----------------------------------------------------------------------- */

/** RFC-4180 parser: quoted fields may contain commas, quotes ("") and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** "2026-07-14 15:32:49 +0530" → Date, or null. */
function parseDate(value) {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(value.trim());
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
}

const num = (value) => {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Shopify prefixes zips with ' to keep spreadsheets from eating zeroes. */
const clean = (value) => String(value ?? "").replace(/^'/, "").trim();

/* ----------------------------------------------------------------------- */
/* Read and group                                                           */
/* ----------------------------------------------------------------------- */

const text = readFileSync(csvPath, "utf8").replace(/^﻿/, "");
const [header, ...rows] = parseCsv(text);
const col = Object.fromEntries(header.map((name, i) => [name, i]));
const get = (row, name) => row[col[name]] ?? "";

// The export is sequential: a row with a non-empty `Id` opens a new order
// (exchange orders can reuse a Name, but never an Id), and rows with a blank
// Id are that order's remaining line items. Grouping by Name alone would merge
// genuine exchange duplicates; grouping by Id alone would orphan continuation
// rows, which leave Id empty.
const groups = new Map();
let current = null;
for (const row of rows) {
  if (get(row, "Id")) {
    current = get(row, "Id");
    groups.set(current, []);
  } else if (!current || get(row, "Name") !== get(groups.get(current)[0], "Name")) {
    console.warn(`orphan continuation row for ${get(row, "Name")} — skipped`);
    continue;
  }
  groups.get(current).push(row);
}

const PAYMENT_MAP = {
  paid: "paid",
  pending: "pending",
  refunded: "refunded",
  partially_refunded: "partially_refunded",
  voided: "voided",
  partially_paid: "partially_paid",
  // An authorization that was never captured behaves like pending money.
  authorized: "pending",
  expired: "voided",
};

const FULFILLMENT_MAP = {
  fulfilled: "fulfilled",
  unfulfilled: "unfulfilled",
  partial: "partial",
  restocked: "restocked",
};

const statuses = { payment: new Map(), fulfillment: new Map() };
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

const orders = [];
for (const [key, groupRows] of groups) {
  const first = groupRows[0];
  const name = get(first, "Name");
  const paymentRaw = (get(first, "Financial Status") || "pending").toLowerCase();
  const fulfillmentRaw = (get(first, "Fulfillment Status") || "unfulfilled").toLowerCase();
  bump(statuses.payment, paymentRaw);
  bump(statuses.fulfillment, fulfillmentRaw);

  const shipping = {
    first_name: clean(get(first, "Shipping Name")).split(/\s+/)[0] ?? "",
    last_name: clean(get(first, "Shipping Name")).split(/\s+/).slice(1).join(" "),
    address1: clean(get(first, "Shipping Address1")),
    address2: clean(get(first, "Shipping Address2")),
    city: clean(get(first, "Shipping City")),
    province: clean(get(first, "Shipping Province Name")) || clean(get(first, "Shipping Province")),
    postal_code: clean(get(first, "Shipping Zip")),
    country: clean(get(first, "Shipping Country")),
    phone: clean(get(first, "Shipping Phone")),
  };
  const billing = {
    first_name: clean(get(first, "Billing Name")).split(/\s+/)[0] ?? "",
    last_name: clean(get(first, "Billing Name")).split(/\s+/).slice(1).join(" "),
    address1: clean(get(first, "Billing Address1")),
    address2: clean(get(first, "Billing Address2")),
    city: clean(get(first, "Billing City")),
    province: clean(get(first, "Billing Province Name")) || clean(get(first, "Billing Province")),
    postal_code: clean(get(first, "Billing Zip")),
    country: clean(get(first, "Billing Country")),
    phone: clean(get(first, "Billing Phone")),
  };

  const items = groupRows
    .filter((row) => get(row, "Lineitem name"))
    .map((row) => ({
      name: get(row, "Lineitem name"),
      price: num(get(row, "Lineitem price")),
      quantity: Math.max(1, num(get(row, "Lineitem quantity")) | 0),
      sku: clean(get(row, "Lineitem sku")),
    }));

  orders.push({
    key,
    name,
    numeric: Number((/\d+/.exec(name) ?? ["0"])[0]),
    email: clean(get(first, "Email")).toLowerCase(),
    phone: clean(get(first, "Phone")) || billing.phone,
    payment_status: PAYMENT_MAP[paymentRaw] ?? "pending",
    fulfillment_status: FULFILLMENT_MAP[fulfillmentRaw] ?? "unfulfilled",
    currency: get(first, "Currency") || "INR",
    subtotal: num(get(first, "Subtotal")),
    shipping_total: num(get(first, "Shipping")),
    tax_total: num(get(first, "Taxes")),
    total: num(get(first, "Total")),
    discount_code: clean(get(first, "Discount Code")) || null,
    discount_total: num(get(first, "Discount Amount")),
    refunded: num(get(first, "Refunded Amount")),
    payment_method: get(first, "Payment Method") || "manual",
    source: get(first, "Source") || "import",
    note: get(first, "Notes"),
    marketing: get(first, "Accepts Marketing").toLowerCase() === "yes",
    created_at: parseDate(get(first, "Created at")) ?? new Date(),
    fulfilled_at: parseDate(get(first, "Fulfilled at")),
    cancelled_at: parseDate(get(first, "Cancelled at")),
    customer_name: billing.first_name || shipping.first_name
      ? billing
      : shipping,
    shipping,
    billing,
    items,
  });
}

// The export reuses names on exchange orders; the unique index cannot.
const seenNames = new Map();
for (const order of orders) {
  const n = seenNames.get(order.name) ?? 0;
  seenNames.set(order.name, n + 1);
  if (n > 0) order.name = `${order.name}_${n + 1}`;
}

const itemCount = orders.reduce((s, o) => s + o.items.length, 0);
console.log(
  `parsed ${rows.length} rows → ${orders.length} orders, ${itemCount} line items`
);
console.log("  financial:  ", Object.fromEntries(statuses.payment));
console.log("  fulfillment:", Object.fromEntries(statuses.fulfillment));

if (dry) process.exit(0);

/* ----------------------------------------------------------------------- */
/* Write                                                                    */
/* ----------------------------------------------------------------------- */

async function insertMany(client, table, columns, rowsIn, returning = "") {
  const out = [];
  // Stay well under the 65535-parameter protocol limit.
  const batch = Math.max(1, Math.floor(30000 / columns.length));
  for (let at = 0; at < rowsIn.length; at += batch) {
    const slice = rowsIn.slice(at, at + batch);
    const values = [];
    const params = [];
    let n = 1;
    for (const row of slice) {
      values.push(`(${row.map(() => `$${n++}`).join(", ")})`);
      params.push(...row);
    }
    const sql = `insert into ${table} (${columns.join(", ")}) values ${values.join(", ")}${
      returning ? ` returning ${returning}` : ""
    }`;
    const { rows: returned } = await client.query(sql, params);
    out.push(...returned);
  }
  return out;
}

const config = dbConfig();
console.log(`target  ${describeTarget(config)}`);
const client = new pg.Client(config);
await client.connect();

try {
  /* -- Split into new orders and drifted ones ----------------------------- */
  // An order already in the database is not necessarily still accurate: a
  // later export can carry a refund, a cancellation or a fulfillment that
  // happened at source after the previous import. So rows are not merely
  // skipped — the order-level facts that can legitimately change afterwards
  // are compared, and the differences replayed as updates.
  //
  // Only those fields are touched. Addresses, line items and money captured at
  // purchase time are snapshots by design, and an import must not rewrite the
  // customer's history to match a later export.
  const { rows: existing } = await client.query(
    `select id, order_name, payment_status, fulfillment_status,
            cancelled_at, closed_at,
            (select coalesce(sum(amount), 0) from refunds r where r.order_id = o.id) as refunded
       from orders o where order_name is not null`
  );
  const have = new Map(existing.map((r) => [r.order_name, r]));
  const pending = orders.filter((o) => !have.has(o.name));

  const same = (a, b) =>
    (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

  const drifted = [];
  for (const order of orders) {
    const row = have.get(order.name);
    if (!row) continue;
    const fulfilledAt =
      order.fulfillment_status === "fulfilled" ? (order.fulfilled_at ?? order.created_at) : null;
    const changes = {};
    if (row.payment_status !== order.payment_status) changes.payment_status = order.payment_status;
    if (row.fulfillment_status !== order.fulfillment_status)
      changes.fulfillment_status = order.fulfillment_status;
    if (!same(row.cancelled_at, order.cancelled_at)) changes.cancelled_at = order.cancelled_at;
    if (!same(row.closed_at, fulfilledAt)) changes.closed_at = fulfilledAt;
    // Refunds are additive rows, not a column: only the shortfall is inserted,
    // so re-running never double-books a refund already recorded.
    const gap = Number((order.refunded - Number(row.refunded)).toFixed(2));
    if (changes.payment_status || changes.fulfillment_status || changes.cancelled_at !== undefined
        || changes.closed_at !== undefined || gap > 0) {
      drifted.push({ id: row.id, name: order.name, changes, refundGap: gap > 0 ? gap : 0, order });
    }
  }

  const unchanged = orders.length - pending.length - drifted.length;
  if (unchanged) console.log(`${unchanged} orders already present and unchanged — skipping them`);
  if (drifted.length) {
    console.log(`${drifted.length} orders changed at source:`);
    for (const d of drifted) {
      const parts = Object.entries(d.changes).map(
        ([k, v]) => `${k}=${v instanceof Date ? v.toISOString() : v}`
      );
      if (d.refundGap) parts.push(`+refund ${d.refundGap}`);
      console.log(`  ${d.name}: ${parts.join(", ")}`);
    }
  }
  if (!pending.length && !drifted.length) {
    console.log("Nothing to import.");
    process.exit(0);
  }

  /* -- Catalogue lookup for SKU/title matching --------------------------- */
  const { rows: variants } = await client.query(
    `select id, product_id, sku from product_variants where coalesce(sku, '') <> ''`
  );
  const { rows: products } = await client.query(
    `select id, sku, title from products`
  );
  const bySkuVariant = new Map(variants.map((v) => [v.sku.toLowerCase(), v]));
  const bySkuProduct = new Map();
  const byTitle = new Map();
  for (const p of products) {
    if (p.sku) bySkuProduct.set(p.sku.toLowerCase(), p);
    byTitle.set(p.title.toLowerCase().trim(), p);
  }

  function matchItem(item) {
    const sku = item.sku.toLowerCase();
    if (sku && bySkuVariant.has(sku)) {
      const v = bySkuVariant.get(sku);
      return { product_id: v.product_id, variant_id: v.id };
    }
    if (sku && bySkuProduct.has(sku)) {
      return { product_id: bySkuProduct.get(sku).id, variant_id: null };
    }
    const whole = item.name.toLowerCase().trim();
    if (byTitle.has(whole)) {
      return { product_id: byTitle.get(whole).id, variant_id: null };
    }
    const cut = item.name.lastIndexOf(" - ");
    if (cut > 0) {
      const title = item.name.slice(0, cut).toLowerCase().trim();
      if (byTitle.has(title)) {
        return { product_id: byTitle.get(title).id, variant_id: null };
      }
    }
    return { product_id: null, variant_id: null };
  }

  await client.query("begin");

  /* -- Customers ---------------------------------------------------------- */
  const { rows: existingCustomers } = await client.query(
    `select id, lower(email) as email from customers where email is not null`
  );
  const customerId = new Map(existingCustomers.map((r) => [r.email, r.id]));

  // One row per new email; earliest order wins for names, any opt-in sticks.
  const wanted = new Map();
  for (const order of [...pending].sort((a, b) => a.created_at - b.created_at)) {
    if (!order.email || customerId.has(order.email)) continue;
    const existing0 = wanted.get(order.email);
    if (existing0) {
      existing0.marketing ||= order.marketing;
      continue;
    }
    wanted.set(order.email, {
      first_name: order.customer_name.first_name,
      last_name: order.customer_name.last_name,
      phone: order.phone,
      address: order.shipping.address1 ? order.shipping : order.billing,
      marketing: order.marketing,
      created_at: order.created_at,
    });
  }

  const newCustomers = await insertMany(
    client,
    "customers",
    ["first_name", "last_name", "email", "phone", "default_address", "accepts_marketing", "created_at"],
    [...wanted.entries()].map(([email, c]) => [
      c.first_name,
      c.last_name,
      email,
      c.phone || null,
      JSON.stringify(c.address),
      c.marketing,
      c.created_at,
    ]),
    "id, lower(email) as email"
  );
  for (const r of newCustomers) customerId.set(r.email, r.id);

  /* -- Orders ------------------------------------------------------------- */
  const orderCols = [
    "order_number", "order_name", "customer_id", "is_draft",
    "payment_status", "fulfillment_status",
    "subtotal", "discount_total", "discount_code", "shipping_total", "tax_total", "total",
    "currency", "note", "email", "phone",
    "shipping_address", "billing_address",
    "payment_method", "source", "marketing_opt_in",
    "created_at", "closed_at", "cancelled_at",
  ];
  const inserted = await insertMany(
    client,
    "orders",
    orderCols,
    pending.map((o) => [
      o.numeric,
      o.name,
      o.email ? (customerId.get(o.email) ?? null) : null,
      false,
      o.payment_status,
      o.fulfillment_status,
      o.subtotal,
      o.discount_total,
      o.discount_code,
      o.shipping_total,
      o.tax_total,
      o.total,
      o.currency,
      o.note,
      o.email,
      o.phone,
      JSON.stringify(o.shipping),
      JSON.stringify(o.billing),
      o.payment_method,
      o.source,
      o.marketing,
      o.created_at,
      o.fulfillment_status === "fulfilled" ? (o.fulfilled_at ?? o.created_at) : null,
      o.cancelled_at,
    ]),
    "id, order_name"
  );
  const orderId = new Map(inserted.map((r) => [r.order_name, r.id]));

  /* -- Items -------------------------------------------------------------- */
  const itemRows = [];
  let matched = 0;
  for (const order of pending) {
    const id = orderId.get(order.name);
    for (const item of order.items) {
      const hit = matchItem(item);
      if (hit.product_id) matched++;
      const cut = item.name.lastIndexOf(" - ");
      itemRows.push([
        id,
        hit.product_id,
        hit.variant_id,
        cut > 0 ? item.name.slice(0, cut) : item.name,
        cut > 0 ? item.name.slice(cut + 3) : "",
        item.price,
        item.quantity,
      ]);
    }
  }
  await insertMany(
    client,
    "order_items",
    ["order_id", "product_id", "variant_id", "title_snapshot", "variant_snapshot", "price_snapshot", "quantity"],
    itemRows
  );

  /* -- Refunds and fulfillments ------------------------------------------- */
  const refundRows = pending
    .filter((o) => o.refunded > 0)
    .map((o) => [orderId.get(o.name), o.refunded, "Imported from Shopify export", false, o.cancelled_at ?? o.created_at]);
  await insertMany(client, "refunds", ["order_id", "amount", "reason", "restock", "created_at"], refundRows);

  const fulfillmentRows = pending
    .filter((o) => o.fulfilled_at)
    .map((o) => [
      orderId.get(o.name),
      "",
      "",
      o.fulfillment_status === "partial" ? "partial" : "fulfilled",
      o.fulfilled_at,
    ]);
  await insertMany(client, "fulfillments", ["order_id", "tracking_number", "carrier", "status", "created_at"], fulfillmentRows);

  /* -- Replay changes onto orders imported earlier ------------------------- */
  // Each drifted order gets one targeted UPDATE naming only the columns that
  // actually moved, so a column the export cannot speak to is never clobbered.
  let driftRefunds = 0;
  for (const d of drifted) {
    const sets = [];
    const params = [];
    for (const [column, value] of Object.entries(d.changes)) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length) {
      params.push(d.id);
      await client.query(`update orders set ${sets.join(", ")} where id = $${params.length}`, params);
    }
    if (d.refundGap > 0) {
      await client.query(
        `insert into refunds (order_id, amount, reason, restock, created_at)
         values ($1, $2, $3, false, $4)`,
        [d.id, d.refundGap, "Imported from Shopify export", d.order.cancelled_at ?? d.order.created_at]
      );
      driftRefunds++;
    }
    // A fulfillment that first appears in a later export needs its row too.
    if (d.changes.fulfillment_status && d.order.fulfilled_at) {
      const { rows: had } = await client.query(
        `select 1 from fulfillments where order_id = $1 limit 1`,
        [d.id]
      );
      if (!had.length) {
        await client.query(
          `insert into fulfillments (order_id, tracking_number, carrier, status, created_at)
           values ($1, '', '', $2, $3)`,
          [d.id, d.order.fulfillment_status === "partial" ? "partial" : "fulfilled", d.order.fulfilled_at]
        );
      }
    }
  }

  /* -- Customer rollups ---------------------------------------------------- */
  await client.query(
    `update customers cu
        set orders_count = coalesce(agg.n, 0),
            total_spent  = coalesce(agg.spent, 0)
       from (select o.customer_id,
                    count(*)::int as n,
                    sum(o.total)  as spent
               from orders o
              where o.customer_id is not null
                and o.is_draft = false
                and o.payment_status in ('paid', 'partially_refunded', 'partially_paid')
              group by o.customer_id) agg
      where agg.customer_id = cu.id`
  );

  // New app-created orders must number past the imported ledger.
  await client.query(
    `select setval('order_number_seq',
                   greatest((select coalesce(max(order_number), 0) from orders),
                            (select last_value from order_number_seq)))`
  );

  await client.query("commit");

  console.log(
    `imported ${inserted.length} orders · ${itemRows.length} items ` +
      `(${matched} matched to catalogue) · ${newCustomers.length} customers · ` +
      `${refundRows.length} refunds · ${fulfillmentRows.length} fulfillments`
  );
  if (drifted.length) {
    console.log(`updated ${drifted.length} existing orders · ${driftRefunds} refunds added`);
  }

  const { rows: check } = await client.query(
    `select count(*)::int as orders,
            round(sum(total), 2) as total,
            min(created_at)::date as first,
            max(created_at)::date as last
       from orders where order_name is not null`
  );
  console.log("db now:", check[0]);
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(`Failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
