"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrders } from "@/lib/analytics/dashboard";
import { requireStaff } from "@/lib/auth/staff";
import {
  addTimelineNote,
  cancelAdvanceRequest,
  cancelOpenRequests,
  createAdvanceRequest,
  recordManualAdvance,
  releaseHold,
  type Actor,
} from "@/lib/cashfree/advance";
import { getQikinkConfig } from "@/lib/qikink/config";
import { pushOrderToQikink } from "@/lib/qikink/fulfillment";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PaymentRequest } from "@/lib/types";

/**
 * Order-page actions for the COD review hold and the advance request.
 *
 * Every one of these runs on the service-role client underneath, so each
 * re-checks staff status first — the same rule as `qikink-actions.ts`, for the
 * same reason: a Server Action is a public POST endpoint, and without the gate
 * anyone could open payment requests against a merchant's orders.
 */

type Result = { ok: true; message: string } | { ok: false; error: string };

/** What the request dialog needs to move straight on to sharing the link. */
export type RequestResult =
  | { ok: true; message: string; request: Pick<PaymentRequest, "id" | "amount" | "expires_at"> }
  | { ok: false; error: string };

/** A snapshot small enough to poll: has anything happened to this request? */
export type AdvanceSnapshot =
  | {
      ok: true;
      requestStatus: PaymentRequest["status"];
      amountPaid: number;
      paymentStatus: string;
    }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard(
  ...ids: unknown[]
): Promise<{ ok: true; actor: Actor } | { ok: false; error: string }> {
  if (ids.some((id) => typeof id !== "string" || !UUID.test(id))) {
    return { ok: false, error: "Invalid id." };
  }
  try {
    const staff = await requireStaff();
    if (!staff.ok) return { ok: false, error: "You do not have permission to do this." };
    return { ok: true, actor: { userId: staff.session.userId, email: staff.session.email } };
  } catch {
    return { ok: false, error: "You do not have permission to do this." };
  }
}

function refresh(orderId: string) {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidateOrders();
}

/** Opens (or replaces) the advance request on a held COD order. */
export async function requestAdvance(
  orderId: string,
  input: { amount: number; expiresInHours: number; reason?: string }
): Promise<RequestResult> {
  const g = await guard(orderId);
  if (!g.ok) return g;

  const result = await createAdvanceRequest(
    orderId,
    {
      amount: Number(input.amount),
      expiresInHours: Number(input.expiresInHours),
      reason: typeof input.reason === "string" ? input.reason : null,
    },
    g.actor
  );
  if (!result.ok) return result;

  refresh(orderId);
  return {
    ok: true,
    message: "Advance requested. Share the link with the customer.",
    request: {
      id: result.value.id,
      amount: Number(result.value.amount),
      expires_at: result.value.expires_at,
    },
  };
}

/**
 * The card polls this while a request is open, so the page turns green the
 * moment Cashfree's webhook settles the advance rather than when someone
 * remembers to reload. Reads only — the webhook and the shopper's own
 * reconcile are what write, and asking Cashfree from here every few seconds
 * would be a request storm for a state change the webhook already delivers.
 */
export async function watchAdvance(orderId: string, requestId: string): Promise<AdvanceSnapshot> {
  const g = await guard(orderId, requestId);
  if (!g.ok) return g;

  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: "Server is not configured for admin reads." };

  const [{ data: request }, { data: order }] = await Promise.all([
    supabase.from("payment_requests").select("status").eq("id", requestId).eq("order_id", orderId).maybeSingle(),
    supabase.from("orders").select("amount_paid, payment_status").eq("id", orderId).maybeSingle(),
  ]);

  if (!request || !order) return { ok: false, error: "Not found." };

  return {
    ok: true,
    requestStatus: request.status as PaymentRequest["status"],
    amountPaid: Number(order.amount_paid ?? 0),
    paymentStatus: String(order.payment_status),
  };
}

/** Withdraws an open request; the order stays held for a decision. */
export async function withdrawAdvance(orderId: string, requestId: string): Promise<Result> {
  const g = await guard(orderId, requestId);
  if (!g.ok) return g;

  const result = await cancelAdvanceRequest(requestId, g.actor);
  if (!result.ok) return result;

  refresh(orderId);
  return { ok: true, message: "Request withdrawn." };
}

/**
 * Lets a held order through as full cash on delivery. Any open request is
 * withdrawn first, so the shopper's page stops asking for money the courier
 * is now going to collect — and then, if auto-send is on, the order goes to
 * Qikink exactly as an unheld COD order would have at checkout.
 */
export async function approveCod(orderId: string): Promise<Result> {
  const g = await guard(orderId);
  if (!g.ok) return g;

  await cancelOpenRequests(orderId);
  const released = await releaseHold(orderId);
  if (released) {
    await addTimelineNote(orderId, "Approved as full cash on delivery.", g.actor);
  }

  let message = released ? "Approved as cash on delivery." : "This order was not on hold.";

  try {
    const config = await getQikinkConfig();
    if (config?.autoSend) {
      const push = await pushOrderToQikink(orderId);
      message += push.ok
        ? ` Sent to Qikink (order ${push.qikinkOrderId}).`
        : ` Qikink: ${push.error}`;
    }
  } catch {
    // The hold is released and recorded; a printer that cannot be reached is
    // retried from the Qikink card, not a reason to undo the decision.
  }

  refresh(orderId);
  return { ok: true, message };
}

/** Staff collected the advance some other way (UPI to the store, cash). */
export async function markAdvanceReceived(orderId: string, requestId: string): Promise<Result> {
  const g = await guard(orderId, requestId);
  if (!g.ok) return g;

  const result = await recordManualAdvance(requestId, g.actor);
  if (!result.ok) return result;

  refresh(orderId);
  return { ok: true, message: "Advance recorded. The order now carries on as partial COD." };
}
