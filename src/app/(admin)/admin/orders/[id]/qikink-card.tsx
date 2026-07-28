"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { QikinkFulfillment } from "@/lib/qikink/fulfillment";
import { refreshQikinkStatus, sendOrderToQikink } from "../qikink-actions";

/**
 * Qikink state for one order.
 *
 * A failed push is shown with its reasons rather than a generic error, because
 * the failures that matter here are all mapping mistakes — a blank SKU, a SKU
 * Qikink doesn't have, a missing state name — and each of them names the fix.
 */
export function QikinkCard({
  orderId,
  fulfillment,
  isDraft,
}: {
  orderId: string;
  fulfillment: QikinkFulfillment | null;
  isDraft: boolean;
}) {
  const router = useRouter();
  const [sending, startSending] = useTransition();
  const [syncing, startSyncing] = useTransition();

  const sent = fulfillment?.status === "sent";
  const failed = fulfillment?.status === "failed";
  // Mapping failures are recorded as one string; split back out so each reason
  // gets its own line instead of a wall of sentences.
  const problems = failed && fulfillment?.error
    ? fulfillment.error.split(/(?<=\.)\s+(?=[A-Z“])/).filter(Boolean)
    : [];

  function handleSend() {
    startSending(async () => {
      const result = await sendOrderToQikink(orderId);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRefresh() {
    startSyncing(async () => {
      const result = await refreshQikinkStatus(orderId);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Qikink</CardTitle>
        <Badge variant={sent ? "default" : failed ? "destructive" : "secondary"}>
          {sent ? "Sent" : failed ? "Failed" : "Not sent"}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {sent && fulfillment && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">Qikink order</dt>
            <dd className="font-medium tabular-nums">{fulfillment.qikink_order_id}</dd>

            {fulfillment.qikink_status && (
              <>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{fulfillment.qikink_status}</dd>
              </>
            )}

            {fulfillment.awb && (
              <>
                <dt className="text-muted-foreground">AWB</dt>
                <dd className="tabular-nums">{fulfillment.awb}</dd>
              </>
            )}

            {fulfillment.tracking_url && (
              <>
                <dt className="text-muted-foreground">Tracking</dt>
                <dd>
                  <a
                    href={fulfillment.tracking_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 font-medium hover:underline"
                  >
                    Track shipment
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </dd>
              </>
            )}

            {fulfillment.sent_at && (
              <>
                <dt className="text-muted-foreground">Sent</dt>
                <dd>{formatDateTime(fulfillment.sent_at)}</dd>
              </>
            )}

            {fulfillment.synced_at && (
              <>
                <dt className="text-muted-foreground">Last checked</dt>
                <dd>{formatDateTime(fulfillment.synced_at)}</dd>
              </>
            )}
          </dl>
        )}

        {failed && (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="font-medium text-destructive">Could not send this order</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {(problems.length ? problems : [fulfillment?.error ?? "Unknown error."]).map(
                (problem, i) => (
                  <li key={i}>{problem}</li>
                )
              )}
            </ul>
          </div>
        )}

        {!sent && !failed && (
          <p className="text-muted-foreground">
            {isDraft
              ? "Convert this draft to an order before sending it to Qikink."
              : "This order has not been sent to Qikink for fulfillment."}
          </p>
        )}

        <div className="flex items-center gap-2">
          {!sent && (
            <Button size="sm" onClick={handleSend} disabled={sending || isDraft}>
              {sending ? "Sending…" : failed ? "Retry send" : "Send to Qikink"}
            </Button>
          )}
          {sent && (
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={syncing}>
              <RefreshCw className={syncing ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
              {syncing ? "Checking…" : "Refresh status"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
