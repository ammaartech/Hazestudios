"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics/track";

/** Matches the beacon's own liveness window; see LIVE_WINDOW_SECONDS. */
const HEARTBEAT_MS = 20_000;

/**
 * Records a page view on every storefront navigation and keeps the session
 * marked alive while the tab is open, which is what "visitors right now" counts.
 *
 * Mounted once in the storefront layout. Deliberately renders nothing and never
 * suspends, so it cannot affect the page it is measuring.
 */
export function AnalyticsTracker() {
  const pathname = usePathname();
  // React 18+ remounts effects in dev StrictMode; without this guard every
  // local page view is counted twice.
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    track("page_view");
  }, [pathname]);

  useEffect(() => {
    // Only beat while the tab is actually visible — a backgrounded tab is not
    // a visitor, and counting it would inflate the live number all day.
    const beat = () => {
      if (document.visibilityState === "visible") {
        track("page_view", { heartbeat: true });
      }
    };

    const interval = setInterval(beat, HEARTBEAT_MS);
    // Re-focusing should register immediately rather than up to 20s later.
    document.addEventListener("visibilitychange", beat);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  return null;
}
