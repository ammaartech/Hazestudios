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
