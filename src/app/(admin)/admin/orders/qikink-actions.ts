"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { pushOrderToQikink, syncQikinkOrder } from "@/lib/qikink/fulfillment";

/**
 * Order-page Qikink actions.
 *
 * Both re-check `is_staff()`: the work underneath runs on the service-role
 * client, so without a gate here a Server Action POST would let anyone send
 * arbitrary orders into a merchant's production queue.
 */

type Result =
  | { ok: true; message: string }
  | { ok: false; error: string; problems?: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard(orderId: unknown): Promise<string | null> {
  if (typeof orderId !== "string" || !UUID.test(orderId)) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("is_staff");
    return data ? orderId : null;
  } catch {
    return null;
  }
}

export async function sendOrderToQikink(orderId: string): Promise<Result> {
  const id = await guard(orderId);
  if (!id) return { ok: false, error: "You do not have permission to do this." };

  const result = await pushOrderToQikink(id);
  revalidatePath(`/admin/orders/${id}`);

  return result.ok
    ? { ok: true, message: `Sent to Qikink (order ${result.qikinkOrderId})` }
    : { ok: false, error: result.error, problems: result.problems };
}

export async function refreshQikinkStatus(orderId: string): Promise<Result> {
  const id = await guard(orderId);
  if (!id) return { ok: false, error: "You do not have permission to do this." };

  const result = await syncQikinkOrder(id);
  revalidatePath(`/admin/orders/${id}`);

  return result.ok
    ? { ok: true, message: "Status refreshed" }
    : { ok: false, error: result.error };
}
