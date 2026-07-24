"use client";

/**
 * Client-side beacon helpers. Shared by the automatic page-view tracker and by
 * any component that wants to record an intent event (cart adds, checkout).
 *
 * Every call is fire-and-forget: analytics must never be able to fail a user
 * action, so nothing here throws or returns a rejected promise.
 */

const SESSION_KEY = "haze_session_key";
const SEEN_KEY = "haze_seen_before";

export type TrackEventType =
  | "page_view"
  | "product_view"
  | "collection_view"
  | "search"
  | "add_to_cart"
  | "checkout_start"
  | "purchase";

export interface TrackOptions {
  path?: string;
  productId?: string;
  productTitle?: string;
  searchQuery?: string;
  value?: number;
  heartbeat?: boolean;
}

/**
 * One key per tab-visit, held in sessionStorage so a refresh continues the same
 * session but a new tab starts a fresh one — the same shape as Shopify sessions.
 */
export function getSessionKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let key = sessionStorage.getItem(SESSION_KEY);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, key);
    }
    return key;
  } catch {
    // Private mode or storage disabled — untracked rather than broken.
    return null;
  }
}

/** localStorage outlives the session, so it answers "new vs returning". */
function isReturning(): boolean {
  try {
    const seen = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, "1");
    return seen === "1";
  } catch {
    return false;
  }
}

export function track(type: TrackEventType, options: TrackOptions = {}) {
  const sessionKey = getSessionKey();
  if (!sessionKey) return;

  const body = JSON.stringify({
    sessionKey,
    type,
    path: options.path ?? window.location.pathname + window.location.search,
    referrer: document.referrer,
    productId: options.productId,
    productTitle: options.productTitle,
    searchQuery: options.searchQuery,
    value: options.value,
    heartbeat: options.heartbeat ?? false,
    returning: isReturning(),
  });

  // sendBeacon survives the page being unloaded mid-navigation, which fetch
  // does not. It caps at ~64KB, far above anything we send here.
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/track",
        new Blob([body], { type: "application/json" })
      );
      return;
    }
  } catch {
    // Fall through to fetch.
  }

  void fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}
