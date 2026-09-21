"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CourierProvider } from "@/lib/couriers/providers";
import { syncCourierTracking } from "./courier-actions";

export function CourierSyncButton({ provider, lastSyncedAt, disabled }: { provider: CourierProvider; lastSyncedAt: string | null; disabled?: boolean }) {
  const router = useRouter();
  const [syncing, startSyncing] = useTransition();

  function handleSync() {
    startSyncing(async () => {
      const result = await syncCourierTracking(provider);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else toast.error(result.error);
    });
  }

  return (
    <div className="flex items-center gap-3">
      {lastSyncedAt && <span className="text-xs text-muted-foreground">Updated {relativeTime(lastSyncedAt)}</span>}
      <Button variant="outline" onClick={handleSync} disabled={syncing || disabled}>
        <RefreshCw className={cn("mr-2 size-4", syncing && "animate-spin")} />
        {syncing ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}

/** Client-side on purpose, so it is right when it paints rather than baked into the HTML. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
