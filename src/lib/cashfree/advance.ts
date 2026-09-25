import { createAdminClient } from "@/lib/supabase/admin";
import { isCodMethod } from "@/lib/shop/payment-methods";
import {
  EXPIRY_HOURS_MAX,
  EXPIRY_HOURS_MIN,
  validateAdvanceAmount,
} from "@/lib/shop/cod-advance";
import { formatMoney as money } from "@/lib/format";
import { getFulfillment } from "@/lib/qikink/fulfillment";
import type { Order, PaymentRequest } from "@/lib/types";
import { settlePayment, type PaymentAttempt } from "./payment";

/**
 * Asking a shopper for an advance on a cash-on-delivery order.
 *
 * The lifecycle of a `payment_requests` row, on the service-role client and
 * written to the same rules as `payment.ts`: nothing throws, every refusal is a
 * sentence the operator can act on, and every decision leaves a note on the
 * order so the timeline tells the story without anyone reading a table.
 *
 * Collecting the money is not here. That is `startCashfreePayment` with a
 * `requestId`, and `settlePayment` recognising the attempt's `request_id` —
 * the existing pipeline, taught to charge less than the total.
 */

const REQUEST_COLUMNS =
  "id, order_id, kind, amount, currency, status, reason, expires_at, created_by, created_by_email, paid_at, payment_id, resolved_at, created_at, updated_at";

export interface Actor {
  userId: string | null;
  email: string | null;
}

type Result<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Every request on an order, newest first. */
export async function getPaymentRequests(orderId: string): Promise<PaymentRequest[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("payment_requests")
    .select(REQUEST_COLUMNS)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  return (data ?? []) as PaymentRequest[];
}

export async function getPaymentRequest(requestId: string): Promise<PaymentRequest | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("payment_requests")
    .select(REQUEST_COLUMNS)
    .eq("id", requestId)
    .maybeSingle();

  return (data as PaymentRequest) ?? null;
}

async function loadOrder(orderId: string): Promise<Order | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;
  const { data } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  return (data as Order) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Notes                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A line on the order's timeline. The same table staff comments live in, with
 * the acting operator as author — so "requested a ₹199 advance" sits next to
 * whatever they typed about why, in the order they happened.
 */
export async function addTimelineNote(
  orderId: string,
  body: string,
  actor?: Actor | null
): Promise<void> {
  const supabase = createAdminClient();
  if (!supabase) return;
  await supabase.from("order_notes").insert({
    order_id: orderId,
    body,
    author_id: actor?.userId ?? null,
    author_email: actor?.email ?? "System",
  });
}

/* -------------------------------------------------------------------------- */
/* Creating                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateRequestInput {
  amount: number;
  expiresInHours: number;
  /** Optional, shown to the shopper. */
  reason?: string | null;
}

/**
 * Opens a request for an advance against a COD order.
 *
 * Refuses anything that would make the request a lie: an order that is not
 * cash on delivery, one already paid or cancelled, and — the one that matters
 * most — an order Qikink already has. Once it is with the printer as full-value
 * COD there is no API to lower the collectable amount, so the courier would ask
 * for the whole total and the shopper would have paid twice.
 *
 * A previous open request is withdrawn rather than refused: "send a new one"
 * is what an operator who changed their mind about the amount means.
 */
export async function createAdvanceRequest(
  orderId: string,
  input: CreateRequestInput,
  actor: Actor
): Promise<Result<PaymentRequest>> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: "Server is not configured for admin writes." };

  const order = await loadOrder(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.is_draft) return { ok: false, error: "Convert the draft to an order first." };
  if (order.cancelled_at) return { ok: false, error: "This order is cancelled." };
  if (!isCodMethod(order.payment_method)) {
    return { ok: false, error: "Only cash-on-delivery orders can take an advance." };
  }
  if (order.payment_status !== "pending") {
    return { ok: false, error: "This order is not awaiting payment." };
  }
  if (!order.checkout_token) {
    return { ok: false, error: "This order has no customer link to pay through." };
  }

  const fulfillment = await getFulfillment(orderId);
  if (fulfillment?.status === "sent") {
    return {
      ok: false,
      error:
        "This order is already with Qikink as full cash on delivery. The collectable amount can't be changed after it's sent.",
    };
  }

  const amount = Math.round(Number(input.amount) * 100) / 100;
  const amountProblem = validateAdvanceAmount(amount, Number(order.total));
  if (amountProblem) return { ok: false, error: amountProblem };

  const hours = Number(input.expiresInHours);
  if (!Number.isFinite(hours) || hours < EXPIRY_HOURS_MIN || hours > EXPIRY_HOURS_MAX) {
    return { ok: false, error: `Validity must be between ${EXPIRY_HOURS_MIN} and ${EXPIRY_HOURS_MAX} hours.` };
  }

  const reason = (input.reason ?? "").trim().slice(0, 300) || null;
  const expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString();

  // Supersede, don't stack. The partial unique index would refuse a second
  // open row anyway; doing it here turns that constraint into the behaviour
  // the operator wanted.
  await supabase
    .from("payment_requests")
    .update({ status: "cancelled", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("status", "open");

  const { data, error } = await supabase
    .from("payment_requests")
    .insert({
      order_id: orderId,
      kind: "cod_advance",
      amount,
      currency: order.currency || "INR",
      reason,
      expires_at: expiresAt,
      created_by: actor.userId,
      created_by_email: actor.email,
    })
    .select(REQUEST_COLUMNS)
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create the request." };
  }

  await addTimelineNote(
    orderId,
    `Requested a ${money(amount, order.currency)} advance on this COD order, valid ${hours}h.${reason ? ` Reason: ${reason}` : ""}`,
    actor
  );

  return { ok: true, value: data as PaymentRequest };
}

/* -------------------------------------------------------------------------- */
/* Resolving                                                                   */
/* -------------------------------------------------------------------------- */

/** Withdraws an open (or lapsed) request. Paid ones are history and stay. */
export async function cancelAdvanceRequest(
  requestId: string,
  actor: Actor
): Promise<Result> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: "Server is not configured for admin writes." };

  const request = await getPaymentRequest(requestId);
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status === "paid") return { ok: false, error: "This advance has already been paid." };
  if (request.status === "cancelled") return { ok: true };

  const { error } = await supabase
    .from("payment_requests")
    .update({ status: "cancelled", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", requestId)
    .neq("status", "paid");
  if (error) return { ok: false, error: error.message };

  await addTimelineNote(
    request.order_id,
    `Withdrew the ${money(request.amount, request.currency)} advance request.`,
    actor
  );
  return { ok: true };
}

/** Every open request on an order, withdrawn. Used when the order itself is decided. */
export async function cancelOpenRequests(orderId: string): Promise<void> {
  const supabase = createAdminClient();
  if (!supabase) return;
  await supabase
    .from("payment_requests")
    .update({ status: "cancelled", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("status", "open");
}

/**
 * Lets a held order through. Conditional on it still being held, so a double
 * click — or the advance landing at the same moment — records one release.
 * Returns whether this call was the one that did it.
 */
export async function releaseHold(orderId: string): Promise<boolean> {
  const supabase = createAdminClient();
  if (!supabase) return false;

  const { data } = await supabase
    .from("orders")
    .update({ released_at: new Date().toISOString() })
    .eq("id", orderId)
    .not("held_at", "is", null)
    .is("released_at", null)
    .select("id");

  return Boolean(data?.length);
}

/**
 * Staff took the money some other way — a UPI transfer to the store's own
 * number, cash at a pop-up — and want the order to carry on as partial COD.
 *
 * Recorded as a `payments` attempt with provider 'manual' so the ledger has a
 * row for it, then settled through the very same `settlePayment` the gateway
 * uses: that is what credits the order, releases the hold and pushes to Qikink
 * with the balance, and having a second way to do those three things is how
 * they drift apart.
 */
export async function recordManualAdvance(
  requestId: string,
  actor: Actor
): Promise<Result> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: "Server is not configured for admin writes." };

  const request = await getPaymentRequest(requestId);
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status === "paid") return { ok: false, error: "This advance is already recorded as paid." };

  const order = await loadOrder(request.order_id);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.payment_status !== "pending") {
    return { ok: false, error: "This order is not awaiting payment." };
  }

  const { count } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id);

  // Alphanumeric and unique, like the Cashfree ids beside it; the M marks it
  // as one no gateway has ever seen.
  const providerOrderId = `HZ${order.order_number}M${(count ?? 0) + 1}`;

  const { data, error } = await supabase
    .from("payments")
    .insert({
      order_id: order.id,
      provider: "manual",
      provider_order_id: providerOrderId,
      request_id: request.id,
      status: "created",
      amount: request.amount,
      currency: request.currency,
      method: "manual",
      request: { recorded_by: actor.email },
    })
    .select("id, order_id, provider, provider_order_id, cf_order_id, cf_payment_id, payment_session_id, status, amount, currency, method, error, created_at, request_id, session_expires_at, gateway_closed_at, gateway_environment")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not record the payment." };

  await settlePayment(data as PaymentAttempt, {
    status: "success",
    paidAmount: Number(request.amount),
    paidCurrency: request.currency,
    method: "manual",
  });

  await addTimelineNote(
    order.id,
    `Recorded the ${money(request.amount, request.currency)} advance as received outside the gateway.`,
    actor
  );

  return { ok: true };
}
