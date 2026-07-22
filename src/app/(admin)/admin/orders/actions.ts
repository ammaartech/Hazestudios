"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Discount } from "@/lib/types";

export interface OrderItemPayload {
  product_id: string;
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

  for (const item of items) {
    if (!item.product_id) continue;
    let query = supabase
      .from("inventory_levels")
      .select("id, quantity")
      .eq("product_id", item.product_id)
      .eq("location_id", defaultLocation.id);
    query = item.variant_id
      ? query.eq("variant_id", item.variant_id)
      : query.is("variant_id", null);
    const { data: level } = await query.limit(1).maybeSingle();
    if (level) {
      await supabase
        .from("inventory_levels")
        .update({ quantity: level.quantity + direction * item.quantity })
        .eq("id", level.id);
    }
  }
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

  const total = Math.max(0, subtotal - discountTotal);

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      customer_id: payload.customer_id,
      is_draft: payload.is_draft,
      payment_status: payload.mark_as_paid && !payload.is_draft ? "paid" : "pending",
      subtotal,
      discount_total: discountTotal,
      discount_code: discountCode,
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
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

export async function markOrderPaid(orderId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("orders")
    .update({ payment_status: "paid" })
    .eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath(`/orders/${orderId}`);
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

  revalidatePath(`/orders/${orderId}`);
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

  revalidatePath(`/orders/${orderId}`);
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
