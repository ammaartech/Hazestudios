import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shree Maruti (InnoFulfill) webhook authentication and payload shape.
 *
 * Documented at docs.innofulfill.com → Webhooks → Delivery Webhook. Each
 * delivery carries `X-Webhook-ID`, `X-Webhook-Event`, `X-Webhook-Timestamp`
 * (RFC 3339) and `X-Webhook-Signature`, described as "HMAC SHA256 signature
 * generated using the webhook signature key and request body". The key is
 * issued in their portal alongside the webhook URL and stored here as the
 * provider's `extra_secret`.
 *
 * The docs do not say how the digest is encoded, so both hex and base64 are
 * accepted — each compared in constant time against its own expected
 * encoding, never by parsing the header. An unsigned or mis-signed delivery is
 * rejected outright: this route changes what an order page says about where a
 * parcel is, and a forged "DELIVERED" is not a harmless mistake.
 */

/** How far out of step with their clock a delivery may be. */
const MAX_SKEW_SECONDS = 15 * 60;

export interface WebhookVerification {
  ok: boolean;
  /** Why it failed, for the server log. Never returned to the caller. */
  reason?: string;
}

function equal(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Checks a delivery against the signing key.
 *
 * `rawBody` must be the exact bytes received — `await request.text()` before
 * any `JSON.parse` — because re-serialising a parsed object reorders keys and
 * the signature will never match.
 */
export function verifyShreeMarutiSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string
): WebhookVerification {
  if (!secret) return { ok: false, reason: "no secret configured" };
  if (!signature) return { ok: false, reason: "missing signature" };
  if (!timestamp) return { ok: false, reason: "missing timestamp" };

  const sent = Date.parse(timestamp);
  if (Number.isNaN(sent)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(Date.now() - sent) / 1000 > MAX_SKEW_SECONDS) return { ok: false, reason: "stale timestamp" };

  const provided = signature.trim().replace(/^sha256=/i, "");
  const mac = createHmac("sha256", secret).update(rawBody);
  const digest = mac.digest();

  if (equal(digest.toString("hex"), provided.toLowerCase())) return { ok: true };
  if (equal(digest.toString("base64"), provided)) return { ok: true };
  return { ok: false, reason: "signature mismatch" };
}

/* -------------------------------------------------------------------------- */
/* Payload                                                                     */
/* -------------------------------------------------------------------------- */

export interface ShreeMarutiWebhookPayload {
  id?: string;
  version?: string;
  timestamp?: string;
  tenantId?: string;
  event?: {
    businessLine?: string;
    categoryCode?: string;
    eventCode?: string;
    triggerEventName?: string;
  };
  data?: {
    orderId?: string;
    referenceId?: string;
    referenceNumber?: string;
    awbNumber?: string;
    orderStatus?: string;
    statusUpdatedAt?: string;
    paymentStatus?: string;
    orderAmount?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** Only status events move a shipment; anything else is recorded and ignored. */
export function isStatusEvent(payload: ShreeMarutiWebhookPayload): boolean {
  const category = payload.event?.categoryCode?.toUpperCase() ?? "";
  const trigger = payload.event?.triggerEventName?.toLowerCase() ?? "";
  return category === "ORDER_STATUS" || trigger.includes("order_status") || Boolean(payload.data?.orderStatus);
}

/**
 * Something unique per event. Their delivery id when present; otherwise the
 * event, the AWB and the status timestamp, which identify a status change
 * just as well since a parcel reaches each status once.
 */
export function webhookIdempotencyKey(headerId: string | null, payload: ShreeMarutiWebhookPayload, rawBody: string): string {
  if (headerId?.trim()) return headerId.trim();
  if (payload.id?.trim()) return payload.id.trim();
  const parts = [payload.event?.eventCode, payload.data?.awbNumber, payload.data?.orderStatus, payload.data?.statusUpdatedAt];
  if (parts.every(Boolean)) return parts.join(":");
  return createHmac("sha256", "courier-webhook").update(rawBody).digest("hex");
}
