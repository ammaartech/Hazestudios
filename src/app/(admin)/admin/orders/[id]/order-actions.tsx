"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, X } from "lucide-react";
import {
  cancelOrder,
  convertDraftToOrder,
  deleteOrder,
  fulfillOrder,
  markOrderPaid,
  refundOrder,
} from "../actions";

export function MarkPaidButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markOrderPaid(orderId);
          if (result.error) toast.error(result.error);
          else {
            toast.success("Order marked as paid");
            router.refresh();
          }
        })
      }
    >
      Mark as paid
    </Button>
  );
}

export function ConvertDraftButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await convertDraftToOrder(orderId);
          if (result.error) toast.error(result.error);
          else {
            toast.success("Draft converted to order");
            router.refresh();
          }
        })
      }
    >
      Convert to order
    </Button>
  );
}

export function DeleteOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      className="text-destructive hover:text-destructive"
      onClick={() => {
        if (!window.confirm("Delete this order? This cannot be undone.")) return;
        startTransition(async () => {
          const result = await deleteOrder(orderId);
          if (result.error) toast.error(result.error);
          else {
            toast.success("Order deleted");
            router.push("/admin/orders");
            router.refresh();
          }
        });
      }}
    >
      Delete
    </Button>
  );
}

export function FulfillDialog({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Fulfill items</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fulfill order</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tracking">Tracking number (optional)</Label>
            <Input
              id="tracking"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="carrier">Carrier (optional)</Label>
            <Input
              id="carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="e.g. UPS, Canada Post"
            />
          </div>
          <Button
            className="w-full"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await fulfillOrder(orderId, tracking, carrier);
                if (result.error) toast.error(result.error);
                else {
                  toast.success("Order fulfilled");
                  setOpen(false);
                  router.refresh();
                }
              })
            }
          >
            {pending ? "Fulfilling…" : "Fulfill"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RefundDialog({
  orderId,
  maxAmount,
}: {
  orderId: string;
  maxAmount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(maxAmount));
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Refund</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund order</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="refund-amount">Refund amount</Label>
            <Input
              id="refund-amount"
              type="number"
              min="0.01"
              max={maxAmount}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="refund-reason">Reason (optional)</Label>
            <Input
              id="refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={restock}
              onCheckedChange={(v) => setRestock(Boolean(v))}
            />
            Restock items at default location
          </label>
          <Button
            className="w-full"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await refundOrder(
                  orderId,
                  parseFloat(amount) || 0,
                  reason,
                  restock
                );
                if (result.error) toast.error(result.error);
                else {
                  toast.success("Refund issued");
                  setOpen(false);
                  router.refresh();
                }
              })
            }
          >
            {pending ? "Refunding…" : "Issue refund"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "More actions", holding the destructive ones.
 *
 * Behind a menu rather than on the toolbar because cancelling is rare and
 * irreversible, while the buttons beside it — fulfil, mark paid — are the daily
 * path. Putting them at equal weight invites the wrong click.
 */
export function OrderActionsMenu({
  orderId,
  cancelled,
}: {
  orderId: string;
  cancelled: boolean;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);

  // Nothing left to offer once the order is cancelled: the only item in this
  // menu is the cancellation itself, and an empty dropdown is worse than none.
  if (cancelled) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            More actions
            <ChevronDown className="ml-2 size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={(e) => {
              // The dialog is a sibling, not a child, of the menu: letting the
              // menu close itself first avoids the focus fight that leaves the
              // dialog unable to take the caret.
              e.preventDefault();
              setCancelOpen(true);
            }}
          >
            <X className="mr-2 size-4" />
            Cancel order
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CancelOrderDialog orderId={orderId} open={cancelOpen} onOpenChange={setCancelOpen} />
    </>
  );
}

function CancelOrderDialog({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [restock, setRestock] = useState(true);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this order?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The order stays on record and keeps its number — it is marked
            cancelled, not deleted.
          </p>

          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox
              checked={restock}
              onCheckedChange={(v) => setRestock(v === true)}
              className="mt-0.5"
            />
            <span>
              Return items to inventory
              {/* Spelled out because the right answer depends on where the
                  goods physically are, which the app cannot know. */}
              <span className="block text-xs text-muted-foreground">
                Leave this off if the parcel has already been picked up.
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Keep order
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await cancelOrder(orderId, restock);
                  if (result.error) toast.error(result.error);
                  else {
                    toast.success("Order cancelled");
                    onOpenChange(false);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? "Cancelling…" : "Cancel order"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
