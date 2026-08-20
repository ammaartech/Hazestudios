import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { QikinkError, listOrders } from "./client";
import { getQikinkConfig } from "./config";
import { alertFor, normalizeStage, type Alert, type QikinkStage } from "./status";

/**
 * Bulk delivery tracking.
 *
 * `syncQikinkOrder` in fulfillment.ts refreshes one order because someone is
 * looking at it. This file exists for the other question — "is anything going
 * wrong across all of them?" — and answers it in a single API call.
 *
 * Qikink's `GET /api/order` returns the whole recent order list, so refreshing
 * two hundred orders costs one request out of the thirty-a-minute budget, not
 * two hundred. That is the only reason a page can afford to sync on load.
 */

/** How long a sync-on-view waits before it is willing to call Qikink again. */
const THROTTLE_MS = 60_000;

/**
 * What counts as a Qikink order.
 *
 * This page is scoped to orders that have a `qikink_fulfillments` row, and
 * nothing else. That row is written the moment a push is attempted — success
 * or failure — so its existence is the record of Qikink involvement, and its
 * absence means the order was never bound for Qikink at all.
 *
 * The alternative that was tried first, and was wrong: filtering by date, on
 * the theory that everything after the integration went live belonged here.
 * It does not. Measured against the live data, of the 25 orders placed since
 * the cutover, 9 are `source: 'admin'` — manually created, and every one of
 * them has line items with no SKU on either the variant or the product. Qikink
 * fulfilment is driven entirely by SKU (see `resolveSkus` in fulfillment.ts),
 * so those orders are not merely unsent, they are unsendable. Order #7699 —
 * pearl skirt, hoop earrings, a brown top — is the case in point: three lines,
 * three null SKUs, nothing Qikink has ever heard of, shown as "still not sent
 * to Qikink" purely because it was placed after an arbitrary date.
 *
 * The seven remaining SKU-capable orders without a row were checked too, in
 * case this filter hid real failures: six are `voided` and one is `pending` —
 * abandoned checkouts, which are deliberately left unpushed. So nothing that
 * ought to be here is excluded by requiring the row.
 *
 * A genuine push failure is not lost either: it writes a row with
 * `status: 'failed'`, which still satisfies the join and still surfaces under
 * "Needs attention" with its error attached.
 */

/**
 * Last successful sync, per process.
 *
 * Process-local, like the token cache above it, and for the same reason: the
 * worst case is a second instance making one extra call. Storing this in the
 * database would mean a write on every page view to save an occasional read.
 */
let lastSyncAt = 0;

export interface TrackedOrder {
  orderId: string;
  orderNumber: number;
  createdAt: string;
  customerName: string;
  total: number;
  currency: string;
  paymentMethod: string;
  paymentStatus: string;

  qikinkOrderId: string | null;
  pushStatus: "queued" | "sent" | "failed" | null;
  qikinkStatus: string | null;
  stage: QikinkStage;
  stageSince: string | null;
  /** Qikink's own order date; the page sorts on this. Null until first synced. */
  qikinkPlacedAt: string | null;
  awb: string | null;
  trackingUrl: string | null;
  sentAt: string | null;
  syncedAt: string | null;
  error: string | null;

  alert: Alert | null;
}

export interface SyncSummary {
  ok: boolean;
  /** Rows whose stage actually moved. */
  changed: number;
  /** Rows seen in Qikink's response and matched to one of ours. */
  matched: number;
  /** Orders adopted by order-number because we had no Qikink id for them. */
  adopted: number;
  skipped?: "throttled" | "not-configured" | "nothing-to-sync";
  error?: string;
}

/**
 * Recovers our order number from Qikink's `number` field.
 *
 * Their format is `<clientId>_<orderNumber>` — "28958_7579" — but a cancelled
 * order gets *renamed* in place to "Cancelled_61_28958_7581", so anything that
 * splits on the first underscore or trusts the field's shape breaks on exactly
 * the orders that matter most. Taking the trailing run of digits survives both
 * forms, which is all we need: our order numbers are plain integers.
 */
export function parseOrderNumber(number: unknown): number | null {
  const match = String(number ?? "").match(/(\d+)\s*$/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Qikink renames cancelled orders; the prefix is the only marker of it. */
function isCancelledRecord(number: unknown): boolean {
  return /^cancelled_/i.test(String(number ?? ""));
}

/** Qikink's clock runs on IST; their timestamps carry no offset to say so. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Parses Qikink's `created_on` into a real instant.
 *
 * The field looks like "2026-08-20 23:00:05" — no zone, no offset, no `T`.
 * Parsing it as UTC (the tempting one-liner) puts every order five and a half
 * hours into the future, which shows up as a negative age on anything created
 * today. It is IST: measured against our own UTC timestamps for three orders
 * placed the same day, the gap was 5.50, 5.51 and 5.53 hours.
 *
 * Returns null rather than an Invalid Date for anything unparseable, so a
 * malformed value falls back to our own timestamp instead of poisoning a sort.
 */
export function parseQikinkDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, y, mo, d, h, mi, s] = match;
  const asIfUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const instant = new Date(asIfUtc - IST_OFFSET_MS);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/* -------------------------------------------------------------------------- */
/* Sync                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Pulls every open order's status from Qikink in one request.
 *
 * `force` is the manual "Sync now" button; without it the throttle applies, so
 * opening the page repeatedly does not spend the rate-limit budget.
 *
 * Never throws. A tracking page that 500s because a supplier's API is down is
 * worse than one that renders the last known state with a warning — the stored
 * data is still the best available answer.
 */
export async function syncAllQikinkOrders(force = false): Promise<SyncSummary> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, changed: 0, matched: 0, adopted: 0, error: "Server is not configured for admin writes." };

  if (!force && Date.now() - lastSyncAt < THROTTLE_MS) {
    return { ok: true, changed: 0, matched: 0, adopted: 0, skipped: "throttled" };
  }

  const config = await getQikinkConfig();
  if (!config) return { ok: false, changed: 0, matched: 0, adopted: 0, skipped: "not-configured", error: "Qikink is not connected." };

  let remote;
  try {
    remote = await listOrders(config);
  } catch (cause) {
    return {
      ok: false,
      changed: 0,
      matched: 0,
      adopted: 0,
      error: cause instanceof QikinkError ? cause.message : "Could not reach Qikink.",
    };
  }

  if (remote.length === 0) {
    lastSyncAt = Date.now();
    return { ok: true, changed: 0, matched: 0, adopted: 0, skipped: "nothing-to-sync" };
  }

  /**
   * Qikink's response is the driver, not our table.
   *
   * The obvious shape — read our open rows, ask about each — cannot see orders
   * we have no `qikink_order_id` for, and those exist: a push can fail locally
   * (a missing postcode) while the order still reaches Qikink by another route,
   * leaving a `failed` row with a null id that no id-based sync will ever
   * repair. Driving from their list instead means an order we mis-recorded is
   * still recognised, by number, and adopted.
   */
  const byNumber = new Map<number, (typeof remote)[number]>();

  for (const o of remote) {
    const number = parseOrderNumber(o.number);
    if (number == null) continue;

    // "28958_7581" and "Cancelled_61_28958_7581" both parse to 7581 — the same
    // order, listed twice, once live and once as its cancelled twin. The live
    // record wins, or an order still in production reads as cancelled.
    const seen = byNumber.get(number);
    if (!seen || (isCancelledRecord(o.number) === false && isCancelledRecord(seen.number))) {
      byNumber.set(number, o);
    }
  }

  // Candidates: every non-terminal fulfillment row, plus the orders Qikink just
  // told us about. Terminal rows are skipped — a delivered parcel has nothing
  // left to report — but that exclusion is applied per row below, not in the
  // query, because a row can be terminal-by-mistake (`not_sent` while Qikink
  // has it delivered) and must still be reachable.
  const { data: rows } = await supabase
    .from("qikink_fulfillments")
    .select("order_id, qikink_order_id, qikink_status, stage, stage_since, qikink_placed_at, awb, tracking_url");

  const existing = (rows ?? []) as {
    order_id: string;
    qikink_order_id: string | null;
    qikink_status: string | null;
    stage: QikinkStage;
    stage_since: string | null;
    qikink_placed_at: string | null;
    awb: string | null;
    tracking_url: string | null;
  }[];

  // Order numbers for the rows we hold, so a remote record can be tied back to
  // an order even when our stored Qikink id is null.
  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, order_number")
    .in("order_number", [...byNumber.keys()]);

  const orderIdByNumber = new Map(
    ((orderRows ?? []) as { id: string; order_number: number }[]).map((o) => [o.order_number, o.id])
  );

  const existingByOrderId = new Map(existing.map((r) => [r.order_id, r]));
  const now = new Date().toISOString();

  let changed = 0;
  let matched = 0;
  let adopted = 0;
  const updates: Record<string, unknown>[] = [];

  for (const [number, record] of byNumber) {
    const orderId = orderIdByNumber.get(number);
    // A Qikink order we have no local order for — a test order placed in their
    // dashboard, or one from before this store. Nothing to attach it to.
    if (!orderId) continue;

    const row = existingByOrderId.get(orderId) ?? null;
    matched += 1;

    const qikinkOrderId = record.order_id != null ? String(record.order_id) : row?.qikink_order_id ?? null;
    if (!row?.qikink_order_id && qikinkOrderId) adopted += 1;

    const qikinkStatus = record.status ?? row?.qikink_status ?? null;
    const awb = record.shipping?.awb ?? row?.awb ?? null;
    // The `Cancelled_NN_` prefix outranks `status`.
    //
    // Qikink renames an order when it is cancelled but does NOT update its
    // `status` field, so a cancelled order keeps reporting whatever it said
    // beforehand — usually "On Hold". Trusting `status` therefore counts every
    // historically-cancelled order as live: measured, 83 records claim "On
    // Hold" while the merchant's dashboard shows 28, and the 55 extras are all
    // renamed cancellations. The rename is the deliberate act and the newer
    // fact, so it wins.
    const stage = isCancelledRecord(record.number)
      ? "cancelled"
      : normalizeStage(qikinkStatus, awb);
    const moved = stage !== row?.stage;
    if (moved) changed += 1;

    updates.push({
      order_id: orderId,
      qikink_order_id: qikinkOrderId,
      // Qikink has it, so the push plainly succeeded whatever we recorded at
      // the time. Leaving it `failed` would keep the order flagged for a
      // problem that has already resolved itself.
      status: "sent",
      error: null,
      qikink_status: qikinkStatus,
      awb,
      tracking_url: record.shipping?.tracking_link ?? row?.tracking_url ?? null,
      stage,
      // Their date, not ours: the tracking page sorts on this so its order
      // matches the Qikink dashboard. Falls back to whatever we already stored
      // rather than null, so a record that briefly omits it keeps its place.
      qikink_placed_at: parseQikinkDate(record.created_on) ?? row?.qikink_placed_at ?? null,
      // Advanced only when the stage actually moved; otherwise the existing
      // timestamp is carried through unchanged, so "stuck for nine days" keeps
      // counting instead of resetting every time someone opens the page.
      //
      // Written on every row rather than spread in conditionally. PostgREST
      // unifies a bulk upsert into a single column list, so a row that omits
      // `stage_since` while a sibling includes it is sent as an explicit NULL —
      // which the NOT NULL constraint rejects, failing the whole batch. Every
      // row must therefore carry the key. `now` is the fallback for a row we
      // have never seen before, which has no earlier timestamp to preserve.
      stage_since: moved ? now : row?.stage_since ?? now,
      synced_at: now,
      updated_at: now,
    });
  }

  if (updates.length > 0) {
    // Upsert on order_id: every row already exists (they came from this table),
    // so this is a batched update that keeps the unique constraint honest.
    const { error } = await supabase
      .from("qikink_fulfillments")
      .upsert(updates, { onConflict: "order_id" });

    if (error) return { ok: false, changed: 0, matched, adopted, error: error.message };
  }

  lastSyncAt = Date.now();
  return { ok: true, changed, matched, adopted };
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

type FulfillmentRow = {
  order_id: string;
  qikink_order_id: string | null;
  status: "queued" | "sent" | "failed";
  qikink_status: string | null;
  stage: QikinkStage;
  stage_since: string | null;
  qikink_placed_at: string | null;
  awb: string | null;
  tracking_url: string | null;
  error: string | null;
  sent_at: string | null;
  synced_at: string | null;
};

type OrderRow = {
  id: string;
  order_number: number;
  created_at: string;
  total: number;
  currency: string;
  payment_method: string;
  payment_status: string;
  customers: { first_name: string; last_name: string; email: string } | null;
  /** Embedded to-one; PostgREST returns object-or-null, never an array. */
  qikink_fulfillments: FulfillmentRow | null;
};

const ORDER_COLUMNS =
  "id, order_number, created_at, total, currency, payment_method, payment_status, " +
  "customers(first_name, last_name, email)";

const FULFILLMENT_EMBED =
  "qikink_order_id, status, qikink_status, stage, stage_since, qikink_placed_at, awb, tracking_url, error, sent_at, synced_at";

/** Stages an order passes through before it is finished, in order. */
export const IN_FLIGHT_STAGES: QikinkStage[] = [
  // Reachable now that the page requires a fulfillment row: `not_sent` here
  // means a row exists but the push failed, which is a real order in a real
  // stuck state — not the "no row at all" case that used to flood this page.
  "not_sent",
  "created",
  // Counted as in flight because the order is still live and still owed to a
  // customer — but it is the one in-flight stage where nothing is happening,
  // which is why it also carries the tightest stale timer in status.ts.
  "on_hold",
  "in_production",
  "picked_up",
  "in_transit",
  "out_for_delivery",
];

export type TrackingTab =
  | "attention"
  | "in_flight"
  | "all"
  | QikinkStage;

export interface TrackedPage {
  orders: TrackedOrder[];
  /** Total matching the current tab, for the pager. */
  total: number;
}

/**
 * One page of tracked orders.
 *
 * Two things here were learned the hard way and are worth keeping:
 *
 * **The fulfillment row is embedded, not fetched separately.** The first cut
 * read orders, then queried `qikink_fulfillments` with `.in("order_id", [...])`.
 * With 500 ids that builds a ~19KB URL, and PostgREST does not merely slow
 * down — the request fails outright (measured: >10s, then `fetch failed`), so
 * every order silently rendered as "not sent". The embed is one round trip
 * against the existing foreign key, and measured ~176ms for a page of 50.
 *
 * **Filtering happens in SQL, not after the fetch.** Selecting the newest 50
 * and then filtering in JS would make "Delivered" show only orders delivered
 * *within those 50* — the tab reads empty while delivered orders sit on page
 * two. The stage filter therefore goes into the query, and the count comes
 * back from the same statement.
 *
 * Read through the caller's session client so staff RLS applies; only the sync
 * needs service-role.
 */
export async function getTrackedOrders(
  client: SupabaseClient,
  options: { tab?: TrackingTab; limit?: number; page?: number } = {}
): Promise<TrackedPage> {
  const tab = options.tab ?? "attention";
  const limit = options.limit ?? 50;
  const page = Math.max(0, options.page ?? 0);

  // "Needs attention" is the one tab SQL cannot express: staleness is computed
  // against wall-clock time from `stage_since`, and RTO/unknown/failed are a
  // union of conditions across both tables. It scans a bounded window instead —
  // wide enough to cover anything worth alerting on, still one query.
  const scanning = tab === "attention";

  // `!inner` makes the embed an inner join, which is what scopes this page to
  // Qikink at all: only orders that actually have a fulfillment row come back.
  // Without it PostgREST applies an embedded filter *inside* the embed and
  // returns every parent row with a null child — measured: 6754 rows for a
  // filter matching 3.
  const embed = `qikink_fulfillments!inner(${FULFILLMENT_EMBED})`;

  let query = client
    .from("orders")
    .select(`${ORDER_COLUMNS}, ${embed}`, { count: "exact" })
    .eq("is_draft", false)
    // Qikink's date, not ours, so the page reads in the same order as the
    // dashboard it mirrors — newest at the top.
    //
    // The `table(column)` spelling is load-bearing. The obvious
    // `.order("qikink_placed_at", { referencedTable: … })` is accepted without
    // error and sorts *within* the embed, leaving the parent rows in their
    // original sequence — silently doing nothing. Only this form reorders the
    // orders themselves. `nullsFirst: false` keeps not-yet-synced rows at the
    // bottom, and `created_at` breaks ties among them deterministically.
    .order("qikink_fulfillments(qikink_placed_at)", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (isStageTab(tab)) {
    query = query.eq("qikink_fulfillments.stage", tab);
  } else if (tab === "in_flight") {
    query = query.in("qikink_fulfillments.stage", IN_FLIGHT_STAGES);
  } else if (scanning) {
    // Delivered and cancelled orders can never raise an alert — `alertFor`
    // returns null for delivered, and cancelled is already surfaced by its own
    // stage rather than by staleness — so keeping them out of the scan is free.
    // It is most of the table: 252 of 349 rows here, which takes the attention
    // query from ~990ms to ~290ms.
    //
    // Safe against the one case that could hide a real alert — a failed push on
    // a terminal row — because `toTracked` maps `status: 'failed'` to
    // `not_sent`, so such a row never reads as terminal in the first place.
    query = query.not("qikink_fulfillments.stage", "in", "(delivered,cancelled)");
  }

  query = scanning
    ? query.limit(ATTENTION_SCAN)
    : query.range(page * limit, page * limit + limit - 1);

  const { data, count } = await query;

  // Via unknown for the same reason the orders list does it: without generated
  // DB types the client types a to-one join as an array, while PostgREST
  // returns object-or-null at runtime.
  const rows = (data ?? []) as unknown as OrderRow[];
  const now = new Date();
  const mapped = rows.map((row) => toTracked(row, now));

  if (!scanning) {
    return { orders: mapped, total: count ?? mapped.length };
  }

  const flagged = mapped.filter((o) => o.alert !== null);
  return {
    orders: flagged.slice(page * limit, page * limit + limit),
    total: flagged.length,
  };
}

/**
 * How many recent orders the "Needs attention" tab examines.
 *
 * Staleness cannot be filtered in SQL without a generated column, so this tab
 * scans. The bound is what keeps that honest: an order old enough to fall out
 * of this window is old enough that a delivery alert on it is no longer
 * actionable, and the query stays one bounded read rather than a full scan.
 */
const ATTENTION_SCAN = 400;

function isStageTab(tab: TrackingTab): tab is QikinkStage {
  return tab !== "attention" && tab !== "in_flight" && tab !== "all";
}

function toTracked(row: OrderRow, now: Date): TrackedOrder {
  const f = row.qikink_fulfillments;

  // No row, or a row that never made it out, both mean the same thing to an
  // operator: Qikink does not have this order.
  // `!f` is unreachable through getTrackedOrders' inner join and kept only for
  // callers that pass a row built some other way; a failed push is the real
  // not_sent case.
  const stage: QikinkStage = !f ? "not_sent" : f.status === "failed" ? "not_sent" : f.stage;

  const customerName = row.customers
    ? `${row.customers.first_name} ${row.customers.last_name}`.trim() || row.customers.email
    : "No customer";

  return {
    orderId: row.id,
    orderNumber: row.order_number,
    createdAt: row.created_at,
    customerName,
    total: row.total,
    currency: row.currency,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,

    qikinkOrderId: f?.qikink_order_id ?? null,
    pushStatus: f?.status ?? null,
    qikinkStatus: f?.qikink_status ?? null,
    stage,
    stageSince: f?.stage_since ?? null,
    qikinkPlacedAt: f?.qikink_placed_at ?? null,
    awb: f?.awb ?? null,
    trackingUrl: f?.tracking_url ?? null,
    sentAt: f?.sent_at ?? null,
    syncedAt: f?.synced_at ?? null,
    error: f?.error ?? null,

    alert: alertFor({
      stage,
      pushStatus: f?.status ?? null,
      error: f?.error ?? null,
      stageSince: f?.stage_since ?? null,
      createdAt: row.created_at,
      now,
    }),
  };
}

/**
 * Headline counts for the page.
 *
 * Counted in the database with head-only requests — no rows cross the wire,
 * only the numbers. The alternative (fetch everything, count in JS) is what the
 * first version did, and it is the same pattern that made the page slow.
 *
 * "Needs attention" is deliberately absent: it depends on wall-clock staleness
 * and cannot be counted without evaluating the alert rules per row. The page
 * takes that number from the attention tab's own result instead.
 */
export async function getTrackingCounts(client: SupabaseClient) {
  const byStage = (stages: QikinkStage[]) =>
    client
      .from("orders")
      .select("id, qikink_fulfillments!inner(stage)", { count: "exact", head: true })
      .eq("is_draft", false)
      .in("qikink_fulfillments.stage", stages);

  const [total, delivered, rto, inFlight] = await Promise.all([
    // Counts Qikink orders, not all orders. "of 6754 orders" beside "0
    // delivered" read as 6,754 missing deliveries, when all but a handful were
    // archive rows Qikink has never heard of. Same `!inner` scope as the table.
    client
      .from("orders")
      .select("id, qikink_fulfillments!inner(order_id)", { count: "exact", head: true })
      .eq("is_draft", false),
    byStage(["delivered"]),
    byStage(["rto"]),
    byStage(IN_FLIGHT_STAGES),
  ]);

  return {
    total: total.count ?? 0,
    delivered: delivered.count ?? 0,
    rto: rto.count ?? 0,
    inFlight: inFlight.count ?? 0,
  };
}
