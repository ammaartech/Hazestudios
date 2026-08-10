import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cashfree webhook authentication.
 *
 * A webhook endpoint is an unauthenticated POST route that moves money in the
 * database, so the signature is not a nicety — without it, anyone who learns
 * the URL can mark any order paid and put goods into production for free. This
 * file is the only thing standing between that and the internet.
 *
 * Cashfree signs with the account's **Secret Key**, the same one used to
 * authenticate outbound calls. There is no separate webhook secret to store.
 */

/**
 * How far out of step with Cashfree's clock a delivery may be.
 *
 * The signature alone proves authorship, not freshness: a captured request
 * replayed a week later still verifies. In practice the idempotency ledger
 * already absorbs replays, so this is the second of two locks rather than the
 * only one — which is why it is generous enough to survive a retry queue
 * draining after an outage.
 */
const MAX_SKEW_SECONDS = 15 * 60;

export interface WebhookVerification {
  ok: boolean;
  /** Why it failed, for the server log. Never returned to the caller. */
  reason?: string;
}

/**
 * Checks a delivery against the account secret.
 *
 * `rawBody` must be the exact bytes received — `await request.text()`, before
 * any `JSON.parse`. Re-serialising a parsed object reorders keys and
 * normalises whitespace, and the resulting signature will never match no matter
 * how correct the rest of this function is. That is the single most common way
 * to get this wrong.
 */
export function verifyWebhookSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secretKey: string
): WebhookVerification {
  if (!timestamp) return { ok: false, reason: "missing timestamp" };
  if (!signature) return { ok: false, reason: "missing signature" };
  if (!secretKey) return { ok: false, reason: "no secret configured" };

  // Cashfree sends epoch seconds. Anything unparseable is treated as hostile
  // rather than tolerated, since a genuine delivery always carries one.
  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "bad timestamp" };

  const skew = Math.abs(Date.now() / 1000 - sent);
  if (skew > MAX_SKEW_SECONDS) return { ok: false, reason: "stale timestamp" };

  const expected = createHmac("sha256", secretKey)
    .update(timestamp + rawBody)
    .digest("base64");

  // Compared byte-wise in constant time. `timingSafeEqual` throws on a length
  // mismatch, and a differing length is itself a failure, so it is checked
  // first — the early return leaks only the length of a base64 SHA-256 digest,
  // which is a constant.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "signature mismatch" };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Payload                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The three payment events this store acts on.
 *
 * Cashfree sends others — refunds, settlements, disputes — and the handler
 * answers those 200 without acting, because anything else makes them retry
 * forever.
 */
export type PaymentWebhookType =
  | "PAYMENT_SUCCESS_WEBHOOK"
  | "PAYMENT_FAILED_WEBHOOK"
  | "PAYMENT_USER_DROPPED_WEBHOOK";

export interface PaymentWebhookPayload {
  type?: string;
  event_time?: string;
  data?: {
    order?: {
      order_id?: string;
      order_amount?: number;
      order_currency?: string;
    };
    payment?: {
      cf_payment_id?: string | number;
      payment_status?: string;
      payment_amount?: number;
      payment_currency?: string;
      payment_group?: string;
      payment_message?: string;
      payment_time?: string;
    };
    customer_details?: Record<string, unknown>;
    error_details?: {
      error_description?: string;
      error_reason?: string;
      error_code?: string;
    };
  };
}

const HANDLED: readonly string[] = [
  "PAYMENT_SUCCESS_WEBHOOK",
  "PAYMENT_FAILED_WEBHOOK",
  "PAYMENT_USER_DROPPED_WEBHOOK",
];

export function isPaymentWebhook(type: unknown): type is PaymentWebhookType {
  return typeof type === "string" && HANDLED.includes(type);
}

/**
 * A stable identity for one delivered event.
 *
 * Prefers Cashfree's own `x-idempotency-header`. Where that is absent — their
 * dashboard's "send test event" is one case — the event type plus the payment
 * id identifies it just as well, because a payment reaches each terminal state
 * exactly once. The fallback to a raw-body hash exists so that a malformed
 * delivery still gets *some* key and lands in the ledger rather than being
 * silently dropped.
 */
export function idempotencyKey(
  header: string | null,
  payload: PaymentWebhookPayload,
  rawBody: string
): string {
  if (header) return header.slice(0, 200);

  const paymentId = payload.data?.payment?.cf_payment_id;
  if (payload.type && paymentId != null) return `${payload.type}:${paymentId}`;

  return `sha256:${createHmac("sha256", "idempotency").update(rawBody).digest("hex")}`;
}
