import { headers } from "next/headers";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveGeo } from "@/lib/analytics/geo";

/**
 * Storefront analytics beacon.
 *
 * Called on every page view and on a heartbeat while the tab is open. It is
 * deliberately forgiving: a malformed or unresolvable hit is dropped with a
 * 204 rather than surfacing an error, because nothing on the storefront should
 * break when analytics is misconfigured.
 */

// Beacons are per-visitor by definition — never prerender or cache this.
export const dynamic = "force-dynamic";

const EVENT_TYPES = [
  "page_view",
  "product_view",
  "collection_view",
  "search",
  "add_to_cart",
  "checkout_start",
  "purchase",
] as const;

type EventType = (typeof EVENT_TYPES)[number];

interface TrackPayload {
  sessionKey?: string;
  type?: string;
  path?: string;
  referrer?: string;
  productId?: string;
  productTitle?: string;
  searchQuery?: string;
  value?: number;
  returning?: boolean;
  /** Heartbeats only bump last_seen_at; they must not inflate the page count. */
  heartbeat?: boolean;
}

function deviceTypeFrom(userAgent: string) {
  if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent)) return "tablet";
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(userAgent)) return "mobile";
  return "desktop";
}

function hostOf(referrer: string) {
  if (!referrer) return "";
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** UUID v4 as produced by crypto.randomUUID on the client. */
function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

const noContent = () => new Response(null, { status: 204 });

export async function POST(request: Request) {
  const supabase = createAdminClient();
  if (!supabase) return noContent();

  let payload: TrackPayload;
  try {
    payload = (await request.json()) as TrackPayload;
  } catch {
    return noContent();
  }

  // The session key is client-generated, so it is untrusted input that reaches
  // a unique index — pin it to the UUID shape rather than accepting any string.
  const sessionKey = payload.sessionKey;
  if (!isUuid(sessionKey)) return noContent();

  const type: EventType = EVENT_TYPES.includes(payload.type as EventType)
    ? (payload.type as EventType)
    : "page_view";

  const headerList = await headers();
  const userAgent = headerList.get("user-agent") ?? "";

  // Bots would otherwise dominate "visitors right now" on a public store.
  if (/bot|crawler|spider|crawling|headlesschrome|lighthouse/i.test(userAgent)) {
    return noContent();
  }

  const path = (payload.path ?? "/").slice(0, 512);
  const referrer = (payload.referrer ?? "").slice(0, 512);
  const now = new Date().toISOString();

  // Does this session already exist? Determines whether we pay for a geo lookup.
  const { data: existing } = await supabase
    .from("analytics_sessions")
    .select("id, page_views")
    .eq("session_key", sessionKey)
    .maybeSingle();

  let sessionId = existing?.id as string | undefined;

  if (!sessionId) {
    // New session: resolve geo once, here, and never again for this visitor.
    const geo = await resolveGeo(headerList);

    const { data: created, error } = await supabase
      .from("analytics_sessions")
      .insert({
        session_key: sessionKey,
        started_at: now,
        last_seen_at: now,
        country: geo.country,
        country_code: geo.countryCode,
        region: geo.region,
        city: geo.city,
        latitude: geo.latitude,
        longitude: geo.longitude,
        referrer,
        referrer_host: hostOf(referrer),
        landing_path: path,
        device_type: deviceTypeFrom(userAgent),
        user_agent: userAgent.slice(0, 512),
        page_views: payload.heartbeat ? 0 : 1,
        is_returning: Boolean(payload.returning),
      })
      .select("id")
      .single();

    if (error || !created) {
      // Lost an insert race against a concurrent beacon for the same key —
      // the row now exists, so read it back instead of failing the hit.
      const { data: raced } = await supabase
        .from("analytics_sessions")
        .select("id")
        .eq("session_key", sessionKey)
        .maybeSingle();
      if (!raced) return noContent();
      sessionId = raced.id as string;
    } else {
      sessionId = created.id as string;
    }
  } else {
    const update: Record<string, unknown> = { last_seen_at: now };
    if (!payload.heartbeat) {
      update.page_views = (existing?.page_views ?? 0) + 1;
    }
    if (type === "checkout_start") update.checkout_started_at = now;
    if (type === "purchase") update.purchased_at = now;

    await supabase
      .from("analytics_sessions")
      .update(update)
      .eq("id", sessionId);
  }

  // A heartbeat is a liveness ping, not a visit — recording one would double
  // every session's page views every 20 seconds.
  if (payload.heartbeat) return noContent();

  await supabase.from("analytics_events").insert({
    session_id: sessionId,
    type,
    path,
    product_id: isUuid(payload.productId) ? payload.productId : null,
    product_title: (payload.productTitle ?? "").slice(0, 255),
    search_query: (payload.searchQuery ?? "").slice(0, 255),
    value: Number.isFinite(payload.value) ? payload.value : 0,
  });

  // Housekeeping runs after the response is sent, so the visitor never waits
  // on it. Sampled, because it does not need to run on every single page view.
  if (Math.random() < 0.002) {
    after(async () => {
      await supabase.rpc("prune_analytics", { older_than: "400 days" });
    });
  }

  return noContent();
}
