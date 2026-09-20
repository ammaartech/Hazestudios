"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { syncQikinkTracking } from "./actions";

export function SyncButton({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const router = useRouter();
  const [syncing, startSyncing] = useTransition();

  function handleSync() {
    startSyncing(async () => {
      const result = await syncQikinkTracking();
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      {lastSyncedAt && (
        <span className="text-xs text-muted-foreground">
          Updated {relativeTime(lastSyncedAt)}
        </span>
      )}
      <Button variant="outline" onClick={handleSync} disabled={syncing}>
        <RefreshCw className={cn("mr-2 size-4", syncing && "animate-spin")} />
        {syncing ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}

/**
 * Rendered client-side on purpose. "Updated 3 minutes ago" computed on the
 * server would be baked into the HTML and then sit there lying as the page
 * stays open; here it is at least right when it paints.
 */
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
