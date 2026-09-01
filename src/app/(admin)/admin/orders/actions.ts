"use server";

import { revalidatePath } from "next/cache";
import { revalidateCatalog } from "@/lib/shop/cache";
import { createClient } from "@/lib/supabase/server";
import type { Discount } from "@/lib/types";

export interface OrderItemPayload {
  /** Null for a custom line with no catalogue entry (a fee, a bespoke item). */
  product_id: string | null;
  variant_id: string | null;
  title: string;
  variant_title: string;
  price: number;
  quantity: number;
}

export interface OrderPayload {
  customer_id: string | null;
  is_draft: boolean;
  mark_as_paid: boolean;
  note: string;
  discount_code: string;
  shipping_total: number;
  items: OrderItemPayload[];
}

async function adjustStock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  items: { product_id: string | null; variant_id: string | null; quantity: number }[],
  direction: 1 | -1
) {
  const { data: defaultLocation } = await supabase
    .from("locations")
    .select("id")
    .eq("is_default", true)
    .limit(1)
    .single();
  if (!defaultLocation) return;

  // Sum the lines per stock-keeping row first. The read-then-write this
  // replaced ran one item at a time, so a second line for the same variant read
  // back the first line's write and accumulated; one batched read hands both
  // lines the same starting quantity, and the second write would clobber the
  // first unless the deltas are added up here instead.
  const deltas = new Map<
    string,
    { product_id: string; variant_id: string | null; quantity: number }
  >();
  for (const item of items) {
    if (!item.product_id) continue;
    const key = `${item.product_id}:${item.variant_id ?? ""}`;
    const entry = deltas.get(key) ?? {
      product_id: item.product_id,
      variant_id: item.variant_id,
      quantity: 0,
    };
    entry.quantity += item.quantity;
    deltas.set(key, entry);
  }

  if (deltas.size) {
    const { data: levels } = await supabase
      .from("inventory_levels")
      .select("id, product_id, variant_id, quantity")
      .eq("location_id", defaultLocation.id)
      .in("product_id", [...new Set([...deltas.values()].map((d) => d.product_id))]);

    const rows = (levels ?? []).flatMap((level) => {
      const delta = deltas.get(`${level.product_id}:${level.variant_id ?? ""}`);
      if (!delta) return [];
      return [
        {
          ...level,
          location_id: defaultLocation.id,
          quantity: level.quantity + direction * delta.quantity,
        },
      ];
    });

    // Every row here came back from the select above, so upserting on the
    // primary key only ever updates. A product with no level at this location
    // stays untracked rather than being handed one at negative stock.
    if (rows.length) await supabase.from("inventory_levels").upsert(rows);
  }

  // Every path that moves stock runs through here — placing an order, refunding
  // one, converting a draft. The storefront serves stock from a shared cache
  // now, so selling the last unit has to drop that cache or the PDP keeps
  // offering an item that is gone.
  revalidateCatalog({
    ids: items.map((i) => i.product_id).filter(Boolean),
  });
}

export async function createOrder(payload: OrderPayload) {
  const supabase = await createClient();

  if (!payload.items.length) return { error: "Add at least one product" };

  const subtotal = payload.items.reduce(
    (sum, i) => sum + i.price * i.quantity,
    0
  );

  let discountTotal = 0;
  let discountCode: string | null = null;
  if (payload.discount_code.trim()) {
    const { data: discountData } = await supabase
      .from("discounts")
      .select("*")
      .ilike("code", payload.discount_code.trim())
      .limit(1)
      .maybeSingle();
    const discount = discountData as Discount | null;
    const now = new Date();
    const valid =
      discount &&
      discount.status === "active" &&
      new Date(discount.starts_at) <= now &&
      (!discount.ends_at || new Date(discount.ends_at) > now) &&
      (!discount.usage_limit || discount.used_count < discount.usage_limit) &&
      (!discount.min_purchase || subtotal >= Number(discount.min_purchase));
    if (!valid) return { error: "Discount code is invalid or expired" };

    if (discount.type === "percentage") {
      discountTotal = (subtotal * Number(discount.value)) / 100;
    } else if (discount.type === "fixed") {
      discountTotal = Math.min(Number(discount.value), subtotal);
    }
    discountCode = discount.code;
    await supabase
      .from("discounts")
      .update({ used_count: discount.used_count + 1 })
      .eq("id", discount.id);
  }

  // Shipping is charged on top, so it is added after the discount is taken off
  // the goods — clamping first would let a large discount eat the freight.
  const shippingTotal = Math.max(0, Number(payload.shipping_total) || 0);
  const total = Math.max(0, subtotal - discountTotal) + shippingTotal;

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      customer_id: payload.customer_id,
      is_draft: payload.is_draft,
      payment_status: payload.mark_as_paid && !payload.is_draft ? "paid" : "pending",
      subtotal,
      discount_total: discountTotal,
      discount_code: discountCode,
      shipping_total: shippingTotal,
      total,
      note: payload.note,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const { error: itemsError } = await supabase.from("order_items").insert(
    payload.items.map((i) => ({
      order_id: order.id,
      product_id: i.product_id,
      variant_id: i.variant_id,
      title_snapshot: i.title,
      variant_snapshot: i.variant_title,
      price_snapshot: i.price,
      quantity: i.quantity,
    }))
  );
  if (itemsError) return { error: itemsError.message };

  if (!payload.is_draft) {
    await adjustStock(supabase, payload.items, -1);
  }

  revalidatePath("/admin/orders");
  return { id: order.id as string };
}

export async function convertDraftToOrder(orderId: string) {
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("order_items")
    .select("product_id, variant_id, quantity")
    .eq("order_id", orderId);

  const { error } = await supabase
    .from("orders")
    .update({ is_draft: false })
    .eq("id", orderId);
  if (error) return { error: error.message };

  await adjustStock(supabase, items ?? [], -1);
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}

export async function markOrderPaid(orderId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("orders")
    .update({ payment_status: "paid" })
    .eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function fulfillOrder(
  orderId: string,
  trackingNumber: string,
  carrier: string
) {
  const supabase = await createClient();

  const { error } = await supabase.from("fulfillments").insert({
    order_id: orderId,
    tracking_number: trackingNumber,
    carrier,
  });
  if (error) return { error: error.message };

  const { error: statusError } = await supabase
    .from("orders")
    .update({
      fulfillment_status: "fulfilled",
      closed_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (statusError) return { error: statusError.message };

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function refundOrder(
  orderId: string,
  amount: number,
  reason: string,
  restock: boolean
) {
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("total, payment_status")
    .eq("id", orderId)
    .single();
  if (!order) return { error: "Order not found" };
  if (amount <= 0 || amount > Number(order.total)) {
    return { error: "Refund amount must be between 0 and the order total" };
  }

  const { error } = await supabase.from("refunds").insert({
    order_id: orderId,
    amount,
    reason,
    restock,
  });
  if (error) return { error: error.message };

  const { data: refunds } = await supabase
    .from("refunds")
    .select("amount")
    .eq("order_id", orderId);
  const refunded = (refunds ?? []).reduce((sum, r) => sum + Number(r.amount), 0);

  const { error: statusError } = await supabase
    .from("orders")
    .update({
      payment_status:
        refunded >= Number(order.total) ? "refunded" : "partially_refunded",
    })
    .eq("id", orderId);
  if (statusError) return { error: statusError.message };

  if (restock) {
    const { data: items } = await supabase
      .from("order_items")
      .select("product_id, variant_id, quantity")
      .eq("order_id", orderId);
    await adjustStock(supabase, items ?? [], 1);
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function deleteOrder(orderId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("orders").delete().eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath("/admin/orders");
  return { ok: true };
}

/**
 * Cancels an order.
 *
 * Restocking is opt-in rather than automatic. A cancellation before anything is
 * picked should return the goods to inventory; one raised after a parcel is
 * already with the courier should not, or the stock count starts describing
 * garments that are in a van. Only the operator knows which case this is, so
 * the dialog asks.
 *
 * `payment_status` is moved to `voided` only when nothing has been captured.
 * A paid order that is cancelled needs a refund, which is its own action with
 * its own money movement — silently marking it voided here would make the books
 * claim a refund happened that never did.
 */
export async function cancelOrder(orderId: string, restock: boolean) {
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("payment_status, cancelled_at")
    .eq("id", orderId)
    .single();

  if (!order) return { error: "Order not found." };
  if (order.cancelled_at) return { error: "This order is already cancelled." };

  if (restock) {
    const { data: items } = await supabase
      .from("order_items")
      .select("product_id, variant_id, quantity")
      .eq("order_id", orderId);

    if (items?.length) {
      await adjustStock(
        supabase,
        items as { product_id: string | null; variant_id: string | null; quantity: number }[],
        1
      );
    }
  }

  const { error } = await supabase
    .from("orders")
    .update({
      cancelled_at: new Date().toISOString(),
      fulfillment_status: restock ? "restocked" : "unfulfilled",
      ...(order.payment_status === "pending" ? { payment_status: "voided" } : {}),
    })
    .eq("id", orderId);

  if (error) return { error: error.message };

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

/**
 * Adds an internal note.
 *
 * The author's email is stamped at write time — see the column comment in
 * 0029: `auth.users` is not readable by the session client, so resolving it per
 * render would cost a privileged lookup for every note.
 */
export async function addOrderNote(orderId: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) return { error: "Write something first." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const { error } = await supabase.from("order_notes").insert({
    order_id: orderId,
    body: trimmed,
    author_id: auth.user?.id ?? null,
    author_email: auth.user?.email ?? null,
  });

  if (error) return { error: error.message };

  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}

export async function deleteOrderNote(noteId: string, orderId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("order_notes").delete().eq("id", noteId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}
