"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/track";

/**
 * Records the purchase against the visitor's session.
 *
 * Client-side because the beacon is keyed on a sessionStorage id the server
 * cannot see. `place_order()` has already written the durable half of this —
 * `analytics_sessions.order_id` and the order's own attribution snapshot — so
 * a blocked beacon costs the funnel's last step and nothing else.
 *
 * Keyed on the order id so a refresh of the confirmation page does not record
 * a second purchase for the same order.
 */
export function PurchaseBeacon({
  orderId,
  total,
}: {
  orderId: string;
  total: number;
}) {
  useEffect(() => {
    const seen = `haze_purchase_${orderId}`;
    try {
      if (sessionStorage.getItem(seen)) return;
      sessionStorage.setItem(seen, "1");
    } catch {
      // Storage unavailable — record it rather than skip it. A duplicated
      // funnel event is a smaller error than a missing conversion.
    }
    track("purchase", { value: total });
  }, [orderId, total]);

  return null;
}
