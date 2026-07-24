"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LiveSnapshot } from "@/lib/analytics/queries";

/**
 * Polls the live snapshot endpoint, seeded with the server-rendered snapshot so
 * the page paints real numbers immediately instead of flashing zeros.
 *
 * Polling rather than Supabase Realtime on purpose: every tile here is an
 * aggregate, so a row-level push would still force a full re-query. One request
 * on a fixed interval is cheaper and degrades more predictably.
 */
export function useLiveSnapshot(initial: LiveSnapshot, intervalMs = 10_000) {
  const [snapshot, setSnapshot] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // Guards against a slow response landing after a newer one.
  const requestId = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      // A hidden tab does not need fresh numbers; skipping keeps an idle admin
      // from generating requests all day.
      if (document.visibilityState !== "visible") return;

      const id = ++requestId.current;
      try {
        const res = await fetch("/api/analytics/live", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as LiveSnapshot;
        if (!cancelled && id === requestId.current) {
          setSnapshot(data);
          setUpdatedAt(new Date());
        }
      } catch {
        // Offline or a dropped request — keep showing the last good snapshot.
      }
    }

    const interval = setInterval(poll, intervalMs);
    document.addEventListener("visibilitychange", poll);
    poll();

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [intervalMs]);

  return { snapshot, updatedAt };
}

/**
 * A clock, modelled as an external store so the label can be derived purely
 * during render. The snapshot is the current 15-second window rather than the
 * raw clock, which keeps it stable between ticks.
 */
const TICK_MS = 15_000;

function subscribeToClock(onTick: () => void) {
  const interval = setInterval(onTick, TICK_MS);
  return () => clearInterval(interval);
}

const currentWindow = () => Math.floor(Date.now() / TICK_MS);
const serverWindow = () => 0;

/** "Just now" / "2m ago", refreshed on a timer so it does not go stale on screen. */
export function useRelativeTime(date: Date | null) {
  const tick = useSyncExternalStore(
    subscribeToClock,
    currentWindow,
    serverWindow
  );

  if (!date || tick === 0) return "Just now";

  const seconds = Math.floor((tick * TICK_MS - date.getTime()) / 1000);
  if (seconds < 45) return "Just now";
  if (seconds < 90) return "1m ago";
  return `${Math.floor(seconds / 60)}m ago`;
}
