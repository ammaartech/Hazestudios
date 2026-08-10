import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCashfreeConfig } from "@/lib/cashfree/config";
import { settleFromWebhook, type Outcome } from "@/lib/cashfree/payment";
import {
  idempotencyKey,
  isPaymentWebhook,
  verifyWebhookSignature,
  type PaymentWebhookPayload,
} from "@/lib/cashfree/webhook";

/**
 * Cashfree payment webhooks.
 *
 * The first webhook receiver in this app, and the only route in it that moves
 * money. Three rules govern everything below.
 *
 * **Verify before parsing.** The signature covers the raw bytes, so the body is
 * read with `request.text()` and nothing touches it until the HMAC matches. An
 * unsigned request must not be able to reach a single line of business logic.
 *
 * **Answer 200 for anything already handled or not ours.** Cashfree retries
 * until it gets one. A 500 for an event we simply do not care about buys an
 * hour of redeliveries; a 500 for one we already processed buys the same, and
 * risks processing it again.
 *
 * **Never let a downstream failure become a non-200.** Qikink being unreachable
 * is not a reason for Cashfree to resend a payment notification — the money
 * arrived either way, and `settlePayment` has already recorded the state that
 * matters.
 *
 * Registered account-wide at Cashfree Dashboard → Developers → Webhooks, so
 * orders carry no `notify_url` of their own.
 */

/** Success with nothing to say. Cashfree reads only the status code. */
function ok(note: string): Response {
  return new Response(note, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();

  const config = await getCashfreeConfig();
  if (!config) {
    // Nothing here can act, and no amount of retrying will change that. A 200
    // stops Cashfree hammering an endpoint whose store has the gateway off.
    return ok("gateway not configured");
  }

  const headerList = await headers();
  const verification = verifyWebhookSignature(
    raw,
    headerList.get("x-webhook-timestamp"),
    headerList.get("x-webhook-signature"),
    config.secretKey
  );

  if (!verification.ok) {
    // The one case that is not a 200. An unverified body is not evidence of
    // anything, so it is not logged as an event either.
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: PaymentWebhookPayload;
  try {
    payload = JSON.parse(raw) as PaymentWebhookPayload;
  } catch {
    // Signed by us, but not JSON. Retrying will produce the same bytes.
    return ok("unparseable");
  }

  const supabase = createAdminClient();
  if (!supabase) {
    // The only genuine "come back later": the store is misconfigured right now
    // but the event is real and unprocessed, so a retry is the right outcome.
    return new Response("Service unavailable", { status: 503 });
  }

  // The ledger insert *is* the lock. Doing it before any work means two
  // deliveries racing on two instances resolve in the database rather than
  // both proceeding to push the same order into production.
  const key = idempotencyKey(
    headerList.get("x-idempotency-header"),
    payload,
    raw
  );

  const { error: ledgerError } = await supabase.from("payment_events").insert({
    idempotency_key: key,
    event_type: payload.type ?? null,
    payload: payload as unknown as Record<string, unknown>,
  });

  if (ledgerError) {
    // 23505 is unique_violation: this exact event has already been handled.
    if (ledgerError.code === "23505") return ok("duplicate");
    return new Response("Service unavailable", { status: 503 });
  }

  if (!isPaymentWebhook(payload.type)) {
    // Refunds, settlements, disputes. Recorded above so there is a trail, but
    // nothing in this store acts on them yet.
    return ok("ignored");
  }

  const providerOrderId = payload.data?.order?.order_id;
  if (!providerOrderId) return ok("no order id");

  const payment = payload.data?.payment;
  const outcome: Outcome = {
    status:
      payload.type === "PAYMENT_SUCCESS_WEBHOOK"
        ? "success"
        : payload.type === "PAYMENT_USER_DROPPED_WEBHOOK"
          ? "user_dropped"
          : "failed",
    cfPaymentId:
      payment?.cf_payment_id != null ? String(payment.cf_payment_id) : null,
    method: payment?.payment_group ?? null,
    // Checked inside settlePayment against what we asked Cashfree to charge.
    // Their `payment_amount` is the figure actually captured, which is the one
    // worth comparing; the order amount is only a fallback.
    paidAmount: payment?.payment_amount ?? payload.data?.order?.order_amount ?? null,
    error:
      payload.data?.error_details?.error_description ??
      payment?.payment_message ??
      null,
    response: payload as unknown as Record<string, unknown>,
  };

  try {
    const settled = await settleFromWebhook(providerOrderId, outcome);
    // An unknown order id is not a retryable condition — it means the payment
    // belongs to a different store or a wiped database, and it will still be
    // unknown in ten minutes. The ledger row stays as the record that it came.
    if (!settled) return ok("unknown order");
  } catch {
    // The ledger row was written before the work, which is what makes a
    // redelivery safe to ignore — so if the work did not happen, the row is a
    // lie and has to go. Removing it and asking for a retry is the only way
    // Cashfree gets a second chance at this event.
    await supabase.from("payment_events").delete().eq("idempotency_key", key);
    return new Response("Service unavailable", { status: 503 });
  }

  return ok("ok");
}
