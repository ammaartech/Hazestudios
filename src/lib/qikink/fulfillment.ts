import { createAdminClient } from "@/lib/supabase/admin";
import type { Order, OrderItem } from "@/lib/types";
import { QikinkError, createOrder, fetchOrder } from "./client";
import { getQikinkConfig } from "./config";
import { isMappingFailure, mapOrderToQikink, type ResolvedItem } from "./map";

/**
 * Pushing an order to Qikink, and reading its progress back.
 *
 * Everything runs on the service-role client: the credentials table is
 * unreadable any other way, and a push triggered by checkout has no staff
 * session behind it to satisfy the staff policy on `qikink_fulfillments`.
 */

export interface QikinkFulfillment {
  order_id: string;
  qikink_order_id: string | null;
  status: "queued" | "sent" | "failed";
  qikink_status: string | null;
  awb: string | null;
  tracking_url: string | null;
  error: string | null;
  sent_at: string | null;
  synced_at: string | null;
}

export type PushResult =
  | { ok: true; qikinkOrderId: string }
  | { ok: false; error: string; problems?: string[] };

const FULFILLMENT_COLUMNS =
  "order_id, qikink_order_id, status, qikink_status, awb, tracking_url, error, sent_at, synced_at";

export async function getFulfillment(orderId: string): Promise<QikinkFulfillment | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("qikink_fulfillments")
    .select(FULFILLMENT_COLUMNS)
    .eq("order_id", orderId)
    .maybeSingle();

  return (data as QikinkFulfillment) ?? null;
}

/**
 * Resolves the Qikink SKU for each line.
 *
 * Read live from the catalogue rather than snapshotted onto the order, because
 * the SKU is a pointer into *Qikink's* records, not a fact about what the
 * customer bought. If the merchant corrects a mistyped SKU after the order came
 * in, the retry should use the corrected one.
 */
async function resolveSkus(items: OrderItem[]): Promise<ResolvedItem[]> {
  const supabase = createAdminClient();
  if (!supabase) return items.map((item) => ({ item, sku: "" }));

  const variantIds = [...new Set(items.map((i) => i.variant_id).filter(Boolean))] as string[];
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))] as string[];

  const [{ data: variants }, { data: products }] = await Promise.all([
    variantIds.length
      ? supabase.from("product_variants").select("id, sku").in("id", variantIds)
      : Promise.resolve({ data: [] as { id: string; sku: string }[] }),
    productIds.length
      ? supabase.from("products").select("id, sku").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; sku: string }[] }),
  ]);

  const bySku = new Map<string, string>();
  for (const v of (variants ?? []) as { id: string; sku: string }[]) bySku.set(v.id, v.sku ?? "");
  for (const p of (products ?? []) as { id: string; sku: string }[]) bySku.set(p.id, p.sku ?? "");

  return items.map((item) => ({
    // A variant's SKU wins: it is the specific colour/size Qikink has to print.
    // The product SKU is only meaningful for items sold without variants.
    item,
    sku: (item.variant_id ? bySku.get(item.variant_id) : bySku.get(item.product_id ?? "")) ?? "",
  }));
}

async function record(
  orderId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const supabase = createAdminClient();
  if (!supabase) return;
  await supabase
    .from("qikink_fulfillments")
    .upsert(
      { order_id: orderId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "order_id" }
    );
}

/**
 * Sends an order to Qikink.
 *
 * Never throws. Both the auto-send path (which must not fail a customer's
 * checkout) and the manual button want the same thing from a failure: it
 * recorded, shown, and retryable. A failed push leaves a row behind precisely
 * so the operator can see *why* rather than an order that looks untouched.
 */
export async function pushOrderToQikink(orderId: string): Promise<PushResult> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: "Server is not configured for admin writes." };

  const config = await getQikinkConfig();
  if (!config) return { ok: false, error: "Qikink is not connected. Add credentials in Settings → Qikink." };

  const existing = await getFulfillment(orderId);
  // Already in production on their side. Re-sending would either be rejected
  // for a duplicate order_number or, worse, accepted as a second job.
  if (existing?.status === "sent" && existing.qikink_order_id) {
    return { ok: true, qikinkOrderId: existing.qikink_order_id };
  }

  const [{ data: orderData }, { data: itemsData }] = await Promise.all([
    supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
    supabase.from("order_items").select("*").eq("order_id", orderId),
  ]);

  if (!orderData) return { ok: false, error: "Order not found." };

  const order = orderData as Order;
  const items = (itemsData ?? []) as OrderItem[];

  if (order.is_draft) {
    return { ok: false, error: "This is still a draft order. Convert it before sending to Qikink." };
  }

  const mapped = mapOrderToQikink(order, await resolveSkus(items));

  if (isMappingFailure(mapped)) {
    const error = mapped.problems.join(" ");
    await record(orderId, { status: "failed", error, response: {} });
    return { ok: false, error: "Order cannot be sent yet.", problems: mapped.problems };
  }

  try {
    const result = await createOrder(config, mapped.payload);
    const qikinkOrderId = result.order_id != null ? String(result.order_id) : "";

    if (!qikinkOrderId) {
      const error = "Qikink accepted the request but returned no order id.";
      await record(orderId, {
        status: "failed",
        error,
        request: mapped.payload,
        response: result as Record<string, unknown>,
      });
      return { ok: false, error };
    }

    await record(orderId, {
      status: "sent",
      qikink_order_id: qikinkOrderId,
      error: null,
      request: mapped.payload,
      response: result as Record<string, unknown>,
      sent_at: new Date().toISOString(),
    });

    return { ok: true, qikinkOrderId };
  } catch (cause) {
    const error =
      cause instanceof QikinkError
        ? cause.message
        : "Could not reach Qikink. Check the connection and try again.";
    await record(orderId, {
      status: "failed",
      error,
      request: mapped.payload,
      response: (cause instanceof QikinkError ? cause.body : null) as Record<string, unknown>,
    });
    return { ok: false, error };
  }
}

/**
 * Refreshes status, AWB and tracking link from Qikink.
 *
 * Pull rather than push: Qikink's Open API offers no webhooks, so progress is
 * only ever known by asking. Called from the order page, which means it costs
 * a request per view rather than a background job — well inside the 30/minute
 * limit for an admin looking at one order.
 */
export async function syncQikinkOrder(orderId: string): Promise<PushResult> {
  const config = await getQikinkConfig();
  if (!config) return { ok: false, error: "Qikink is not connected." };

  const fulfillment = await getFulfillment(orderId);
  if (!fulfillment?.qikink_order_id) {
    return { ok: false, error: "This order has not been sent to Qikink yet." };
  }

  try {
    const remote = await fetchOrder(config, fulfillment.qikink_order_id);
    if (!remote) return { ok: false, error: "Qikink no longer has this order." };

    await record(orderId, {
      qikink_status: remote.status ?? null,
      awb: remote.shipping?.awb ?? null,
      tracking_url: remote.shipping?.tracking_link ?? null,
      synced_at: new Date().toISOString(),
    });

    return { ok: true, qikinkOrderId: fulfillment.qikink_order_id };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof QikinkError ? cause.message : "Could not reach Qikink.",
    };
  }
}
