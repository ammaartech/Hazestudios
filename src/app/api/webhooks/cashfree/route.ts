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
    // Missing credentials or a transient settings read must not acknowledge money
    // that has not been recorded. Retry after configuration is restored.
    return new Response("Service unavailable", { status: 503 });
  }

  const headerList = request.headers;
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

  const key = idempotencyKey(headerList.get("x-idempotency-header"), payload, raw);
  if (!isPaymentWebhook(payload.type)) {
    const { error } = await supabase.from("payment_events").upsert({
      idempotency_key: key, event_type: payload.type ?? null, payload,
    }, { onConflict: "provider,idempotency_key", ignoreDuplicates: true });
    return error ? new Response("Service unavailable", { status: 503 }) : ok("ignored");
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
    paidCurrency: payment?.payment_currency ?? payload.data?.order?.order_currency ?? null,
    error:
      payload.data?.error_details?.error_description ??
      payment?.payment_message ??
      null,
    response: payload as unknown as Record<string, unknown>,
  };

  try {
    await settleFromWebhook(providerOrderId, outcome, {
      key, type: payload.type!, payload: payload as unknown as Record<string, unknown>,
    });
  } catch {
    // No ledger entry commits unless settlement commits. Unknown attempts retry too.
    console.error("[commerce] webhook settlement deferred", { providerOrderId });
    return new Response("Service unavailable", { status: 503 });
  }

  return ok("ok");
}
