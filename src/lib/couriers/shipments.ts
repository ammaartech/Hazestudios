import { createAdminClient } from "@/lib/supabase/admin";
import { addTimelineNote, type Actor } from "@/lib/cashfree/advance";
import { formatMoney } from "@/lib/format";
import type { Order, OrderItem } from "@/lib/types";
import { adapterFor, isCourierError, type Booked, type LatestStatus } from "./adapters";
import { getCourierConfig, getCourierSettings, type CourierConfig } from "./config";
import { buildShipmentDraft, type PackageInput, type ShipmentDraft } from "./draft";
import { COURIERS, serviceLabel, type CourierProvider } from "./providers";
import {
  isInFlight,
  isShipmentStage,
  normalizeShipmentStage,
  shipmentAlert,
  type ShipmentAlert,
  type ShipmentStage,
} from "./status";

/**
 * Booking a parcel with a courier, and everything that follows from it.
 *
 * Everything runs on the service-role client: the credentials table is
 * unreadable any other way, and the webhook route that also lands here has no
 * staff session. The Server Actions in front of this module are the gate.
 *
 * The shape mirrors `qikink/fulfillment.ts` — never throw at the caller, record
 * every failure as a row with its reason, keep the exact request and response
 * — with one addition that Qikink never needed: a booking is also a
 * fulfillment. The AWB is written to `fulfillments`, which is what the shopper
 * sees on their order page, and the order is marked fulfilled the same way
 * "Mark as fulfilled" would have. Cancelling the booking undoes both.
 *
 * Nothing here knows a courier's wire format: every call to one goes through
 * its adapter (`adapters.ts`), which is what keeps four integrations from
 * becoming four copies of this file.
 */

export interface CourierShipment {
  id: string;
  order_id: string;
  provider: CourierProvider;
  status: "booked" | "failed" | "cancelled";
  awb: string | null;
  provider_order_id: string | null;
  service: string;
  payment_mode: "prepaid" | "cod";
  collectable_amount: number;
  declared_value: number;
  weight_kg: number;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  pieces: number;
  provider_status: string | null;
  stage: ShipmentStage;
  stage_since: string | null;
  tracking_url: string | null;
  label_path: string | null;
  destination_area: string | null;
  destination_location: string | null;
  error: string | null;
  created_by_email: string | null;
  booked_at: string | null;
  synced_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Everything but the request/response blobs, which are large and diagnostic. */
const SHIPMENT_COLUMNS =
  "id, order_id, provider, status, awb, provider_order_id, service, payment_mode, collectable_amount, declared_value, " +
  "weight_kg, length_cm, width_cm, height_cm, pieces, provider_status, stage, stage_since, tracking_url, label_path, " +
  "destination_area, destination_location, error, created_by_email, booked_at, synced_at, cancelled_at, created_at, updated_at";

const LABEL_BUCKET = "shipping-labels";

type Db = NonNullable<ReturnType<typeof createAdminClient>>;

function toShipment(row: Record<string, unknown>): CourierShipment {
  const stage = row.stage;
  return {
    ...(row as unknown as CourierShipment),
    stage: isShipmentStage(stage) ? stage : "unknown",
    collectable_amount: Number(row.collectable_amount ?? 0),
    declared_value: Number(row.declared_value ?? 0),
    weight_kg: Number(row.weight_kg ?? 0),
    length_cm: row.length_cm == null ? null : Number(row.length_cm),
    width_cm: row.width_cm == null ? null : Number(row.width_cm),
    height_cm: row.height_cm == null ? null : Number(row.height_cm),
    pieces: Number(row.pieces ?? 1),
  };
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Every attempt for an order, newest first. */
export async function getShipmentsForOrder(orderId: string): Promise<CourierShipment[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("courier_shipments")
    .select(SHIPMENT_COLUMNS)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toShipment);
}

export async function getShipment(shipmentId: string): Promise<CourierShipment | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("courier_shipments")
    .select(SHIPMENT_COLUMNS)
    .eq("id", shipmentId)
    .maybeSingle();
  return data ? toShipment(data as unknown as Record<string, unknown>) : null;
}

/** The one shipment currently in the courier's hands, if any. */
export function liveShipment(shipments: CourierShipment[]): CourierShipment | null {
  return shipments.find((s) => s.status === "booked") ?? null;
}

/* -------------------------------------------------------------------------- */
/* Drafting                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * SKU per line, from the catalogue. Read live rather than snapshotted, and
 * keyed by the line's id so a product and its variant can never be confused.
 */
async function resolveItemSkus(supabase: Db, items: OrderItem[]): Promise<Map<string, string>> {
  const variantIds = [...new Set(items.map((i) => i.variant_id).filter(Boolean))] as string[];
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))] as string[];

  const [{ data: variants }, { data: products }] = await Promise.all([
    variantIds.length
      ? supabase.from("product_variants").select("id, sku").in("id", variantIds)
      : Promise.resolve({ data: [] as { id: string; sku: string | null }[] }),
    productIds.length
      ? supabase.from("products").select("id, sku").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; sku: string | null }[] }),
  ]);

  const byId = new Map<string, string>();
  for (const v of (variants ?? []) as { id: string; sku: string | null }[]) byId.set(v.id, v.sku ?? "");
  for (const p of (products ?? []) as { id: string; sku: string | null }[]) byId.set(p.id, p.sku ?? "");

  const result = new Map<string, string>();
  for (const item of items) {
    const sku = (item.variant_id ? byId.get(item.variant_id) : byId.get(item.product_id ?? "")) ?? "";
    if (sku.trim()) result.set(item.id, sku.trim());
  }
  return result;
}

async function loadOrder(supabase: Db, orderId: string): Promise<{ order: Order; items: OrderItem[] } | null> {
  const [{ data: orderData }, { data: itemsData }] = await Promise.all([
    supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
    supabase.from("order_items").select("*").eq("order_id", orderId).order("id"),
  ]);
  if (!orderData) return null;
  return { order: orderData as Order, items: (itemsData ?? []) as OrderItem[] };
}

/**
 * The draft the order page shows, built from the same code the booking uses.
 * Null when the order does not exist.
 */
export async function draftForOrder(orderId: string, pkg?: Partial<PackageInput> | null): Promise<ShipmentDraft | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;
  const loaded = await loadOrder(supabase, orderId);
  if (!loaded) return null;
  const [settings, skus] = await Promise.all([getCourierSettings(), resolveItemSkus(supabase, loaded.items)]);
  return buildShipmentDraft({ order: loaded.order, items: loaded.items, skus, settings, pkg });
}

/* -------------------------------------------------------------------------- */
/* Booking                                                                     */
/* -------------------------------------------------------------------------- */

export interface BookInput {
  orderId: string;
  provider: CourierProvider;
  service: string;
  pkg: PackageInput;
  note?: string;
  actor: Actor | null;
}

export type BookResult =
  | { ok: true; shipment: CourierShipment; warnings: string[] }
  | { ok: false; error: string; problems?: string[] };

/**
 * A `booked` row with no AWB is a booking in progress — the row is inserted
 * before the courier is called so that two clicks resolve in the database.
 * One older than this without an AWB is a process that died mid-call, and is
 * released so the operator is not locked out of their own order.
 */
const STALE_LOCK_MS = 2 * 60_000;

export async function bookShipment(input: BookInput): Promise<BookResult> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: "Server is not configured for admin writes." };

  const meta = COURIERS[input.provider];
  if (!meta.services.some((s) => s.code === input.service)) {
    return { ok: false, error: `“${input.service}” is not a ${meta.name} service.` };
  }

  const config = await getCourierConfig(input.provider);
  if (!config) {
    return { ok: false, error: `${meta.name} is not connected. Add its credentials in Settings → Shipping.` };
  }

  const loaded = await loadOrder(supabase, input.orderId);
  if (!loaded) return { ok: false, error: "Order not found." };
  const { order, items } = loaded;

  const [settings, skus] = await Promise.all([getCourierSettings(), resolveItemSkus(supabase, items)]);
  const draft = buildShipmentDraft({ order, items, skus, settings, pkg: input.pkg });

  // Already booked? Say with whom rather than letting the unique index answer.
  const existing = liveShipment(await getShipmentsForOrder(input.orderId));
  if (existing) {
    if (!existing.awb && Date.now() - new Date(existing.created_at).getTime() > STALE_LOCK_MS) {
      await supabase
        .from("courier_shipments")
        .update({ status: "failed", error: "Booking did not complete.", updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else if (existing.awb) {
      return {
        ok: false,
        error: `This order is already booked with ${COURIERS[existing.provider].name} (${existing.awb}). Cancel that shipment first.`,
      };
    } else {
      return { ok: false, error: "A booking for this order is already in progress." };
    }
  }

  const base = {
    order_id: order.id,
    provider: input.provider,
    service: input.service,
    payment_mode: draft.paymentMode,
    collectable_amount: draft.collectableAmount,
    declared_value: draft.declaredValue,
    weight_kg: draft.pkg.weightKg,
    length_cm: draft.pkg.lengthCm,
    width_cm: draft.pkg.widthCm,
    height_cm: draft.pkg.heightCm,
    pieces: draft.pkg.pieces,
    created_by: input.actor?.userId ?? null,
    created_by_email: input.actor?.email ?? null,
  };

  if (draft.problems.length) {
    await supabase.from("courier_shipments").insert({
      ...base,
      status: "failed",
      stage: "not_booked",
      error: draft.problems.join(" "),
    });
    return { ok: false, error: "This order cannot be shipped yet.", problems: draft.problems };
  }

  // The lock. Inserted as `booked` with no AWB *before* the API call; the
  // partial unique index refuses a second live row for the order, so a
  // double-click or two staff on the same page cannot produce two waybills.
  const { data: inserted, error: insertError } = await supabase
    .from("courier_shipments")
    .insert({ ...base, status: "booked", stage: "not_booked" })
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      return { ok: false, error: "A booking for this order is already in progress." };
    }
    return { ok: false, error: insertError?.message ?? "Could not start the booking." };
  }
  const shipmentId = inserted.id as string;

  const attempt = 1 + (await countAttempts(supabase, order.id, input.provider));
  const now = new Date().toISOString();

  try {
    const booked: Booked = await adapterFor(input.provider).book(config, draft, {
      service: input.service,
      note: input.note ?? "",
      attempt,
    });

    // The label first, while we still have the bytes; a storage failure must
    // not undo a booking the courier has already made.
    let labelPath: string | null = null;
    const warnings: string[] = [];
    if (booked.labelPdf) {
      labelPath = await storeLabel(supabase, order.id, shipmentId, booked.labelPdf);
      if (!labelPath) warnings.push("The courier's label could not be saved. Reprint it from the courier's own portal.");
    }

    const trackingUrl = meta.trackingUrl(booked.awb);
    const { data: updated } = await supabase
      .from("courier_shipments")
      .update({
        awb: booked.awb,
        provider_order_id: booked.providerOrderId,
        provider_status: booked.providerStatus,
        stage: "booked",
        stage_since: now,
        tracking_url: trackingUrl,
        label_path: labelPath,
        destination_area: booked.destinationArea,
        destination_location: booked.destinationLocation,
        request: booked.request,
        response: booked.response,
        error: null,
        booked_at: now,
        updated_at: now,
      })
      .eq("id", shipmentId)
      .select(SHIPMENT_COLUMNS)
      .single();

    await fulfil(supabase, order, booked.awb, meta.name, trackingUrl);

    const money = formatMoney(draft.collectableAmount, order.currency);
    await addTimelineNote(
      order.id,
      `Booked with ${meta.name} — ${meta.awbLabel} ${booked.awb} (${serviceLabel(input.provider, input.service)}, ` +
        `${draft.paymentMode === "cod" ? `COD ${money} to collect` : "prepaid"}).`,
      input.actor
    );

    return { ok: true, shipment: toShipment(updated as unknown as Record<string, unknown>), warnings };
  } catch (cause) {
    const error = describeFailure(cause, meta.name);
    await supabase
      .from("courier_shipments")
      .update({
        status: "failed",
        stage: "not_booked",
        error,
        request: (cause as { request?: unknown })?.request ?? {},
        response: failureBody(cause),
        updated_at: new Date().toISOString(),
      })
      .eq("id", shipmentId);
    return { ok: false, error };
  }
}

/** Bookings attempted so far for this order with this courier — for unique references. */
async function countAttempts(supabase: Db, orderId: string, provider: CourierProvider): Promise<number> {
  const { count } = await supabase
    .from("courier_shipments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("provider", provider);
  // The lock row just inserted is one of them.
  return Math.max(0, (count ?? 1) - 1);
}

async function storeLabel(supabase: Db, orderId: string, shipmentId: string, pdf: Uint8Array): Promise<string | null> {
  const path = `${orderId}/${shipmentId}.pdf`;
  const { error } = await supabase.storage
    .from(LABEL_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  return error ? null : path;
}

/**
 * The fulfillment that the booking is. Same two writes as `fulfillOrder` in
 * the orders actions, so the order reads Fulfilled everywhere and the shopper's
 * page gets the carrier, the AWB and — new with 0034 — a link to track it.
 */
async function fulfil(supabase: Db, order: Order, awb: string, carrier: string, trackingUrl: string): Promise<void> {
  await supabase.from("fulfillments").insert({
    order_id: order.id,
    tracking_number: awb,
    carrier,
    tracking_url: trackingUrl,
  });
  await supabase
    .from("orders")
    .update({ fulfillment_status: "fulfilled", closed_at: new Date().toISOString() })
    .eq("id", order.id);
}

function describeFailure(cause: unknown, courier: string): string {
  if (isCourierError(cause)) return cause.message;
  if (cause instanceof Error && /fetch|network|ECONN|ENOTFOUND|timeout/i.test(cause.message)) {
    return `Could not reach ${courier}. Check the connection and try again.`;
  }
  return cause instanceof Error && cause.message ? cause.message : `${courier} returned an unexpected error.`;
}

function failureBody(cause: unknown): Record<string, unknown> {
  const body = (cause as { body?: unknown })?.body;
  if (body && typeof body === "object") return body as Record<string, unknown>;
  if (typeof body === "string") return { text: body.slice(0, 2000) };
  return {};
}

/* -------------------------------------------------------------------------- */
/* Cancelling                                                                  */
/* -------------------------------------------------------------------------- */

export type CancelResult = { ok: true; shipment: CourierShipment } | { ok: false; error: string };

/**
 * Cancels with the courier and puts the order back to unfulfilled — but only
 * if the courier agrees. A parcel already picked up cannot be cancelled by
 * API, and the row must keep saying "booked" until it can, because that is
 * the truth.
 */
export async function cancelShipment(shipmentId: string, reason: string, actor: Actor | null): Promise<CancelResult> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: "Server is not configured for admin writes." };

  const shipment = await getShipment(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found." };
  if (shipment.status !== "booked" || !shipment.awb) return { ok: false, error: "This shipment is not booked." };
  if (shipment.stage !== "booked" && shipment.stage !== "unknown" && shipment.stage !== "not_booked") {
    return { ok: false, error: "The courier has already picked this parcel up; it can no longer be cancelled here." };
  }

  const meta = COURIERS[shipment.provider];
  const config = await getCourierConfig(shipment.provider);
  if (!config) return { ok: false, error: `${meta.name} is not connected.` };

  try {
    await adapterFor(shipment.provider).cancel(config, { awb: shipment.awb, providerOrderId: shipment.provider_order_id }, reason);
  } catch (cause) {
    return { ok: false, error: describeFailure(cause, meta.name) };
  }

  const now = new Date().toISOString();
  const { data: updated } = await supabase
    .from("courier_shipments")
    .update({ status: "cancelled", stage: "cancelled", stage_since: now, cancelled_at: now, error: null, updated_at: now })
    .eq("id", shipmentId)
    .select(SHIPMENT_COLUMNS)
    .single();

  await unfulfil(supabase, shipment.order_id, shipment.awb);
  await addTimelineNote(
    shipment.order_id,
    `Cancelled the ${meta.name} booking (${meta.awbLabel} ${shipment.awb})${reason.trim() ? ` — ${reason.trim()}` : ""}.`,
    actor
  );

  return { ok: true, shipment: toShipment(updated as unknown as Record<string, unknown>) };
}

/** Removes the fulfillment a booking created and, if nothing else fulfils the order, reopens it. */
async function unfulfil(supabase: Db, orderId: string, awb: string): Promise<void> {
  await supabase.from("fulfillments").delete().eq("order_id", orderId).eq("tracking_number", awb);
  const { count } = await supabase
    .from("fulfillments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);
  if (!count) {
    await supabase.from("orders").update({ fulfillment_status: "unfulfilled", closed_at: null }).eq("id", orderId);
  }
}

/* -------------------------------------------------------------------------- */
/* Syncing                                                                     */
/* -------------------------------------------------------------------------- */

export type SyncResult =
  | { ok: true; shipment: CourierShipment; changed: boolean }
  | { ok: false; error: string };

/** Pulls the courier's latest word on one shipment. */
export async function syncShipment(shipmentId: string): Promise<SyncResult> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: "Server is not configured for admin writes." };

  const shipment = await getShipment(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found." };
  if (!shipment.awb) return { ok: false, error: "This shipment has no AWB to track." };

  const meta = COURIERS[shipment.provider];
  const config = await getCourierConfig(shipment.provider);
  if (!config) return { ok: false, error: `${meta.name} is not connected.` };

  try {
    const latest = await fetchLatest(config, shipment);
    const updated = await applyStatus(supabase, shipment, latest);
    return { ok: true, shipment: updated, changed: updated.stage !== shipment.stage };
  } catch (cause) {
    return { ok: false, error: describeFailure(cause, meta.name) };
  }
}

async function fetchLatest(config: CourierConfig, shipment: CourierShipment): Promise<LatestStatus | null> {
  return adapterFor(shipment.provider).track(config, { awb: shipment.awb as string, providerOrderId: shipment.provider_order_id });
}

/**
 * Writes a courier's latest status onto the row. The stage clock restarts
 * only when the stage genuinely moved, or "stuck for N days" would reset on
 * every refresh and the tracking page could never raise an alert. A stage
 * going *backwards* (their "created" scan arriving after "picked up") is kept
 * as their status text but does not move our stage.
 */
async function applyStatus(supabase: Db, shipment: CourierShipment, latest: LatestStatus | null): Promise<CourierShipment> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { synced_at: now, updated_at: now };

  if (latest) {
    patch.provider_status = latest.providerStatus;
    const regressed =
      latest.stage !== "unknown" &&
      !isTerminalOrDetour(latest.stage) &&
      rank(latest.stage) < rank(shipment.stage);
    if (latest.stage !== shipment.stage && !regressed) {
      patch.stage = latest.stage;
      patch.stage_since = latest.at ?? now;
    }
  }

  const { data } = await supabase
    .from("courier_shipments")
    .update(patch)
    .eq("id", shipment.id)
    .select(SHIPMENT_COLUMNS)
    .single();
  return toShipment(data as unknown as Record<string, unknown>);
}

function isTerminalOrDetour(stage: ShipmentStage): boolean {
  return stage === "delivered" || stage === "rto" || stage === "cancelled" || stage === "undelivered";
}

function rank(stage: ShipmentStage): number {
  const order: ShipmentStage[] = ["not_booked", "booked", "picked_up", "in_transit", "out_for_delivery", "delivered"];
  const i = order.indexOf(stage);
  return i < 0 ? -1 : i;
}

/**
 * A status pushed by the courier (Shree Maruti's webhook). Matched on the AWB;
 * an AWB we do not know is not an error — it may belong to a booking made on
 * their portal directly — and is reported as unmatched.
 */
export async function applyPushedStatus(input: {
  provider: CourierProvider;
  awb: string;
  providerStatus: string;
  at: string | null;
}): Promise<"updated" | "unmatched"> {
  const supabase = createAdminClient();
  if (!supabase) return "unmatched";

  const { data } = await supabase
    .from("courier_shipments")
    .select(SHIPMENT_COLUMNS)
    .eq("provider", input.provider)
    .eq("awb", input.awb)
    .eq("status", "booked")
    .maybeSingle();
  if (!data) return "unmatched";

  const shipment = toShipment(data as unknown as Record<string, unknown>);
  await applyStatus(supabase, shipment, {
    providerStatus: input.providerStatus,
    stage: normalizeShipmentStage(input.provider, input.providerStatus, { hasAwb: true }),
    at: input.at,
  });
  return "updated";
}

export interface BulkSyncSummary {
  ok: boolean;
  checked: number;
  changed: number;
  skipped?: "throttled" | "not-configured" | "nothing-to-sync";
  error?: string;
}

/** Last bulk sync per provider, per process — a courtesy to their rate limits. */
const lastBulkSync = new Map<CourierProvider, number>();
const BULK_THROTTLE_MS = 60_000;
const BULK_LIMIT = 40;
const BULK_CONCURRENCY = 3;

/**
 * Refreshes every in-flight shipment with one courier, oldest-checked first.
 * Neither API has a list-by-status call worth using here, so this is one
 * request per parcel; the limit and the concurrency keep a click on "Sync
 * now" to a few seconds and well inside anyone's rate limit.
 */
export async function syncInFlight(provider: CourierProvider, options: { force?: boolean } = {}): Promise<BulkSyncSummary> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, checked: 0, changed: 0, error: "Server is not configured for admin writes." };

  const last = lastBulkSync.get(provider) ?? 0;
  if (!options.force && Date.now() - last < BULK_THROTTLE_MS) {
    return { ok: true, checked: 0, changed: 0, skipped: "throttled" };
  }

  const config = await getCourierConfig(provider);
  if (!config) return { ok: false, checked: 0, changed: 0, skipped: "not-configured", error: `${COURIERS[provider].name} is not connected.` };

  const { data } = await supabase
    .from("courier_shipments")
    .select(SHIPMENT_COLUMNS)
    .eq("provider", provider)
    .eq("status", "booked")
    .not("awb", "is", null)
    .order("synced_at", { ascending: true, nullsFirst: true })
    .limit(BULK_LIMIT);

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(toShipment).filter((s) => isInFlight(s.stage));
  if (!rows.length) return { ok: true, checked: 0, changed: 0, skipped: "nothing-to-sync" };

  lastBulkSync.set(provider, Date.now());

  let changed = 0;
  let firstError: string | undefined;
  for (let i = 0; i < rows.length; i += BULK_CONCURRENCY) {
    const batch = rows.slice(i, i + BULK_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (shipment) => {
        try {
          const latest = await fetchLatest(config, shipment);
          const updated = await applyStatus(supabase, shipment, latest);
          return updated.stage !== shipment.stage;
        } catch (cause) {
          firstError ??= describeFailure(cause, COURIERS[provider].name);
          return false;
        }
      })
    );
    changed += results.filter(Boolean).length;
  }

  return { ok: !firstError, checked: rows.length, changed, error: firstError };
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

export type LabelResult = { ok: true; pdf: Uint8Array; filename: string } | { ok: false; error: string };

/**
 * The printable label. Blue Dart's was saved at booking; Shree Maruti's is
 * generated on request and cached in the same bucket the first time.
 */
export async function getShipmentLabel(shipmentId: string): Promise<LabelResult> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: "Server is not configured for admin writes." };

  const shipment = await getShipment(shipmentId);
  if (!shipment || !shipment.awb) return { ok: false, error: "Shipment not found." };
  const filename = `${COURIERS[shipment.provider].name.replace(/\s+/g, "")}-${shipment.awb}.pdf`;

  if (shipment.label_path) {
    const { data } = await supabase.storage.from(LABEL_BUCKET).download(shipment.label_path);
    if (data) return { ok: true, pdf: new Uint8Array(await data.arrayBuffer()), filename };
  }

  const meta = COURIERS[shipment.provider];
  const adapter = adapterFor(shipment.provider);
  if (!adapter.label) {
    return { ok: false, error: `No label was saved for this ${meta.awbLabel.toLowerCase()}. Reprint it from ${meta.name}'s portal.` };
  }

  const config = await getCourierConfig(shipment.provider);
  if (!config) return { ok: false, error: `${meta.name} is not connected.` };

  try {
    const pdf = await adapter.label(config, { awb: shipment.awb, providerOrderId: shipment.provider_order_id });
    const path = await storeLabel(supabase, shipment.order_id, shipment.id, pdf);
    if (path) await supabase.from("courier_shipments").update({ label_path: path }).eq("id", shipment.id);
    return { ok: true, pdf, filename };
  } catch (cause) {
    return { ok: false, error: describeFailure(cause, meta.name) };
  }
}

/* -------------------------------------------------------------------------- */
/* Tracking page                                                               */
/* -------------------------------------------------------------------------- */

export type ShipmentTab =
  | "attention"
  | "in_flight"
  | "booked"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "undelivered"
  | "rto"
  | "cancelled"
  | "failed"
  | "all";

export interface TrackedShipment extends CourierShipment {
  orderNumber: number;
  customerName: string;
  orderTotal: number;
  currency: string;
  alert: ShipmentAlert | null;
}

export interface TrackedPage {
  shipments: TrackedShipment[];
  total: number;
}

/**
 * Shipments with one courier for the tracking page, joined to their orders.
 * "Needs attention" is computed here rather than in SQL because it depends on
 * the clock — how long a stage has sat — and on rules that live in
 * `status.ts`; it reads every live row for the courier, which is bounded by
 * how many parcels are in flight at once, not by history.
 */
export async function listTrackedShipments(
  provider: CourierProvider,
  options: { tab: ShipmentTab; page: number; pageSize: number }
): Promise<TrackedPage> {
  const supabase = createAdminClient();
  if (!supabase) return { shipments: [], total: 0 };

  let query = supabase
    .from("courier_shipments")
    .select(`${SHIPMENT_COLUMNS}, orders!inner(order_number, total, currency, shipping_address, email)`, { count: "exact" })
    .eq("provider", provider)
    .order("created_at", { ascending: false });

  const { tab } = options;
  const inFlight = ["booked", "picked_up", "in_transit", "out_for_delivery", "undelivered", "unknown"];
  if (tab === "in_flight") query = query.eq("status", "booked").in("stage", inFlight);
  else if (tab === "failed") query = query.eq("status", "failed");
  else if (tab === "cancelled") query = query.eq("status", "cancelled");
  else if (tab !== "all" && tab !== "attention") query = query.eq("status", "booked").eq("stage", tab);
  else if (tab === "attention") query = query.neq("status", "cancelled");

  const paged = tab === "attention" ? query : query.range(options.page * options.pageSize, (options.page + 1) * options.pageSize - 1);
  const { data, count } = await paged;

  type OrderBits = { order_number: number; total: number; currency: string; shipping_address: Record<string, string> | null; email: string | null };
  type Row = Record<string, unknown> & { orders: OrderBits | OrderBits[] | null };

  let rows: TrackedShipment[] = ((data ?? []) as unknown as Row[]).map((row) => {
    const { orders: joined, ...rest } = row;
    // A many-to-one join comes back as one object; the client's types say
    // array, and a defensive read costs nothing.
    const orders: OrderBits = (Array.isArray(joined) ? joined[0] : joined) ?? {
      order_number: 0, total: 0, currency: "INR", shipping_address: null, email: null,
    };
    const shipment = toShipment(rest);
    const a = orders.shipping_address ?? {};
    return {
      ...shipment,
      orderNumber: orders.order_number,
      customerName: [a.first_name, a.last_name].filter(Boolean).join(" ") || orders.email || "—",
      orderTotal: Number(orders.total),
      currency: orders.currency,
      alert: shipmentAlert({
        status: shipment.status,
        stage: shipment.stage,
        error: shipment.error,
        stageSince: shipment.stage_since,
        createdAt: shipment.created_at,
      }),
    };
  });

  if (tab === "attention") {
    rows = rows.filter((r) => r.alert);
    const total = rows.length;
    const start = options.page * options.pageSize;
    return { shipments: rows.slice(start, start + options.pageSize), total };
  }

  return { shipments: rows, total: count ?? rows.length };
}

export interface TrackingCounts {
  inFlight: number;
  delivered: number;
  rto: number;
  total: number;
}

export async function getTrackingCounts(provider: CourierProvider): Promise<TrackingCounts> {
  const supabase = createAdminClient();
  const empty = { inFlight: 0, delivered: 0, rto: 0, total: 0 };
  if (!supabase) return empty;

  const { data } = await supabase
    .from("courier_shipments")
    .select("stage, status")
    .eq("provider", provider)
    .eq("status", "booked");

  const counts = { ...empty };
  for (const row of (data ?? []) as { stage: string; status: string }[]) {
    counts.total += 1;
    const stage = isShipmentStage(row.stage) ? row.stage : "unknown";
    if (stage === "delivered") counts.delivered += 1;
    else if (stage === "rto") counts.rto += 1;
    else if (isInFlight(stage)) counts.inFlight += 1;
  }
  return counts;
}
