"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics/track";

/**
 * Records a product_view alongside the automatic page_view, which is what the
 * "Top products by views" report reads. The title is sent with the event so the
 * report still names the product after it is deleted.
 */
export function ProductViewTracker({
  productId,
  productTitle,
}: {
  productId: string;
  productTitle: string;
}) {
  // Guards the StrictMode double-effect in dev, same as the page tracker.
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (sent.current === productId) return;
    sent.current = productId;
    track("product_view", { productId, productTitle });
  }, [productId, productTitle]);

  return null;
}
