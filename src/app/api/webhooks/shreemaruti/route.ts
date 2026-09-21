import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCourierConfig } from "@/lib/couriers/config";
import { applyPushedStatus } from "@/lib/couriers/shipments";
import {
  isStatusEvent,
  verifyShreeMarutiSignature,
  webhookIdempotencyKey,
  type ShreeMarutiWebhookPayload,
} from "@/lib/couriers/shreemaruti/webhook";

/**
 * Shree Maruti (InnoFulfill) delivery webhooks.
 *
 * Same three rules as the Cashfree receiver, for the same reasons. Verify
 * before parsing — the signature covers the raw bytes. Answer 200 for anything
 * already handled or not ours, because a retried "ignored" is a wasted hour of
 * redeliveries. Never let our own failure to *use* an event become a non-200,
 * except the one case where the event is real and unprocessed and a retry
 * would genuinely help.
 *
 * Register the URL — `/api/webhooks/shreemaruti` on the store's public origin
 * — in their portal's webhook settings, and paste the signing key they issue
 * into Settings → Shipping → Shree Maruti.
 */

function ok(note: string): Response {
  return new Response(note, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();

  const config = await getCourierConfig("shreemaruti");
  if (!config) return ok("courier not configured");
  if (!config.webhookSecret) {
    // A webhook with no key to check it against is one we cannot trust. Not
    // a 200: the operator has registered the URL but not the key, and a
    // string of 401s in their portal is the fastest way to say so.
    return new Response("Webhook secret not configured", { status: 401 });
  }

  const headerList = await headers();
  const verification = verifyShreeMarutiSignature(
    raw,
    headerList.get("x-webhook-timestamp"),
    headerList.get("x-webhook-signature"),
    config.webhookSecret
  );
  if (!verification.ok) return new Response("Unauthorized", { status: 401 });

  let payload: ShreeMarutiWebhookPayload;
  try {
    payload = JSON.parse(raw) as ShreeMarutiWebhookPayload;
  } catch {
    return ok("unparseable");
  }

  const supabase = createAdminClient();
  if (!supabase) return new Response("Service unavailable", { status: 503 });

  // The ledger insert is the lock: two deliveries racing on two instances
  // resolve here, and only one goes on to touch the shipment.
  const key = webhookIdempotencyKey(headerList.get("x-webhook-id"), payload, raw);
  const awb = payload.data?.awbNumber?.trim() || null;

  const { error: ledgerError } = await supabase.from("courier_events").insert({
    provider: "shreemaruti",
    idempotency_key: key,
    event_type: payload.event?.triggerEventName ?? headerList.get("x-webhook-event") ?? null,
    awb,
    payload: payload as unknown as Record<string, unknown>,
  });
  if (ledgerError) {
    if (ledgerError.code === "23505") return ok("duplicate");
    return new Response("Service unavailable", { status: 503 });
  }

  if (!isStatusEvent(payload) || !awb || !payload.data?.orderStatus) return ok("ignored");

  try {
    const outcome = await applyPushedStatus({
      provider: "shreemaruti",
      awb,
      providerStatus: payload.data.orderStatus,
      at: payload.data.statusUpdatedAt && !Number.isNaN(Date.parse(payload.data.statusUpdatedAt))
        ? new Date(payload.data.statusUpdatedAt).toISOString()
        : null,
    });
    if (outcome === "updated") {
      revalidatePath("/admin/orders/tracking/shreemaruti");
    }
    return ok(outcome);
  } catch {
    // The ledger row says "handled"; if it was not, it must go so a retry can
    // have another chance at the event.
    await supabase.from("courier_events").delete().eq("provider", "shreemaruti").eq("idempotency_key", key);
    return new Response("Service unavailable", { status: 503 });
  }
}
