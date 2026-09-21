"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Printer, RefreshCw, Truck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime, formatMoney } from "@/lib/format";
import { COURIERS, serviceLabel } from "@/lib/couriers/providers";
import type { CourierShipment } from "@/lib/couriers/shipments";
import { shipmentStageLabel } from "@/lib/couriers/status";
import { cancelCourierShipment, refreshCourierShipment } from "../ship-actions";

/**
 * The courier booking on an order — the counterpart of `QikinkCard` for
 * parcels the store ships itself.
 *
 * Reads top-down as the parcel's story: who has it, under what number, what
 * they were told to collect, where it is now. The actions are the ones that
 * make sense from the current stage and no others: a parcel the courier has
 * scanned cannot be cancelled from here, so the button is not offered rather
 * than offered and refused.
 *
 * Past attempts stay visible under "History". A booking that failed on a bad
 * pincode and was then made with the other courier is a sequence the operator
 * may need to explain to a customer, and an overwritten row cannot tell it.
 */
export function ShipmentCard({ shipments, currency }: { shipments: CourierShipment[]; currency: string }) {
  const router = useRouter();
  const [syncing, startSyncing] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);

  const live = shipments.find((s) => s.status === "booked") ?? null;
  const history = shipments.filter((s) => s !== live);
  const latestFailure = !live ? shipments.find((s) => s.status === "failed") ?? null : null;

  if (!live && !shipments.length) return null;

  const meta = live ? COURIERS[live.provider] : null;
  const money = (n: number) => formatMoney(n, currency);
  const cancellable = live && (live.stage === "booked" || live.stage === "unknown" || live.stage === "not_booked");

  function handleRefresh() {
    if (!live) return;
    startSyncing(async () => {
      const result = await refreshCourierShipment(live.id);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else toast.error(result.error);
    });
  }

  return (
    <section className="order-card shipment-card">
      <div className="section-heading">
        <h2 className="flex items-center gap-2">
          <span className="section-icon">
            <Truck size={16} />
          </span>
          Shipment
        </h2>
        {live ? (
          <Badge variant={live.stage === "delivered" ? "default" : live.stage === "rto" || live.stage === "undelivered" ? "destructive" : "secondary"}>
            {shipmentStageLabel(live.stage)}
          </Badge>
        ) : latestFailure ? (
          <Badge variant="destructive">Booking failed</Badge>
        ) : (
          <Badge variant="secondary">Not booked</Badge>
        )}
      </div>

      {live && meta && (
        <>
          <dl className="shipment-facts">
            <dt>Courier</dt>
            <dd>
              {meta.name}
              <span className="order-muted"> · {serviceLabel(live.provider, live.service)}</span>
            </dd>

            <dt>{meta.awbLabel}</dt>
            <dd>
              <Awb value={live.awb ?? ""} />
            </dd>

            {live.provider_order_id && (
              <>
                <dt>Their order</dt>
                <dd className="tabular-nums">{live.provider_order_id}</dd>
              </>
            )}

            <dt>Payment</dt>
            <dd>{live.payment_mode === "cod" ? `COD — courier collects ${money(live.collectable_amount)}` : "Prepaid"}</dd>

            <dt>Parcel</dt>
            <dd>
              {live.weight_kg} kg
              {live.length_cm && live.width_cm && live.height_cm && (
                <span className="order-muted">
                  {" "}
                  · {live.length_cm} × {live.width_cm} × {live.height_cm} cm
                </span>
              )}
              {live.pieces > 1 && <span className="order-muted"> · {live.pieces} pieces</span>}
            </dd>

            {live.provider_status && (
              <>
                <dt>Courier says</dt>
                <dd>{live.provider_status}</dd>
              </>
            )}

            {(live.destination_location || live.destination_area) && (
              <>
                <dt>Routed via</dt>
                <dd>{[live.destination_location, live.destination_area].filter(Boolean).join(" · ")}</dd>
              </>
            )}

            <dt>Booked</dt>
            <dd>
              {live.booked_at ? formatDateTime(live.booked_at) : "—"}
              {live.created_by_email && <span className="order-muted"> by {live.created_by_email}</span>}
            </dd>

            {live.synced_at && (
              <>
                <dt>Last checked</dt>
                <dd>{formatDateTime(live.synced_at)}</dd>
              </>
            )}
          </dl>

          <div className="shipment-actions">
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/admin/shipments/${live.id}/label`} target="_blank" rel="noreferrer noopener">
                <Printer className="size-3.5" aria-hidden />
                Label
              </a>
            </Button>
            {live.tracking_url && (
              <Button size="sm" variant="outline" asChild>
                <a href={live.tracking_url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="size-3.5" aria-hidden />
                  Track
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={syncing}>
              <RefreshCw className={syncing ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
              {syncing ? "Checking…" : "Refresh status"}
            </Button>
            {cancellable && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
                <XCircle className="size-3.5" aria-hidden />
                Cancel booking
              </Button>
            )}
          </div>

          <CancelDialog shipment={live} open={cancelOpen} onOpenChange={setCancelOpen} />
        </>
      )}

      {!live && latestFailure && (
        <div className="shipment-failure">
          <p className="font-medium text-destructive">
            {COURIERS[latestFailure.provider].name} did not accept this booking
          </p>
          <ul className="list-disc space-y-1 pl-5 order-muted">
            {splitProblems(latestFailure.error).map((problem, i) => (
              <li key={i}>{problem}</li>
            ))}
          </ul>
          <p className="order-muted mt-2 text-xs">
            {formatDateTime(latestFailure.created_at)}
            {latestFailure.created_by_email && ` · ${latestFailure.created_by_email}`}
          </p>
        </div>
      )}

      {history.length > 0 && (live || history.length > 1) && (
        <details className="shipment-history">
          <summary className="cursor-pointer order-muted">
            History · {history.length} earlier {history.length === 1 ? "attempt" : "attempts"}
          </summary>
          <ul className="mt-2 space-y-2">
            {history.map((s) => (
              <li key={s.id} className="text-xs">
                <span className="font-medium">{COURIERS[s.provider].name}</span>{" "}
                <span className="order-muted">
                  · {s.status === "cancelled" ? "cancelled" : s.status === "failed" ? "failed" : shipmentStageLabel(s.stage)}
                  {s.awb && ` · ${s.awb}`} · {formatDateTime(s.cancelled_at ?? s.created_at)}
                </span>
                {s.status === "failed" && s.error && <p className="order-muted mt-0.5">{s.error}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Mapping failures are one string of sentences; give each its own line. */
function splitProblems(error: string | null): string[] {
  if (!error) return ["Unknown error."];
  const parts = error.split(/(?<=\.)\s+(?=[A-Z“])/).filter(Boolean);
  return parts.length ? parts : [error];
}

function Awb({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono font-medium tabular-nums">{value || "—"}</span>
      {value && (
        <button type="button" onClick={copy} aria-label="Copy" className="order-muted inline-flex size-6 items-center justify-center rounded hover:bg-accent">
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
        </button>
      )}
    </span>
  );
}

function CancelDialog({
  shipment,
  open,
  onOpenChange,
}: {
  shipment: CourierShipment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const meta = COURIERS[shipment.provider];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this booking?</DialogTitle>
          <DialogDescription>
            {meta.name} will be asked to cancel {meta.awbLabel.toLowerCase()} {shipment.awb}. The order goes back to unfulfilled so it can be
            booked again. This only works before the parcel is picked up.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Reason (optional)</Label>
          <Input id="cancel-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Wrong address, customer cancelled…" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep booking
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await cancelCourierShipment(shipment.id, reason);
                if (result.ok) {
                  toast.success(result.message);
                  onOpenChange(false);
                  router.refresh();
                } else toast.error(result.error);
              })
            }
          >
            {pending ? "Cancelling…" : "Cancel booking"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
