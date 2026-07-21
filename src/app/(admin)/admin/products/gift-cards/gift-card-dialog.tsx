"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Customer } from "@/lib/types";
import { issueGiftCard } from "./actions";

export function GiftCardDialog({
  customers,
}: {
  customers: Pick<Customer, "id" | "first_name" | "last_name" | "email">[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [customerId, setCustomerId] = useState<string>("none");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, startTransition] = useTransition();

  function handleIssue() {
    startTransition(async () => {
      const result = await issueGiftCard({
        initial_value: parseFloat(value) || 0,
        customer_id: customerId === "none" ? null : customerId,
        note,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Gift card issued");
      setOpen(false);
      setValue("");
      setNote("");
      setExpiresAt("");
      setCustomerId("none");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Issue gift card</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue gift card</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gc-value">Value</Label>
            <Input
              id="gc-value"
              type="number"
              min="1"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="50.00"
            />
          </div>
          <div className="space-y-2">
            <Label>Customer (optional)</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger aria-label="Customer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No customer</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {`${c.first_name} ${c.last_name}`.trim() || c.email || c.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gc-expires">Expiration date (optional)</Label>
            <Input
              id="gc-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gc-note">Note</Label>
            <Input
              id="gc-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Internal note"
            />
          </div>
          <Button
            onClick={handleIssue}
            disabled={pending || !value}
            className="w-full"
          >
            {pending ? "Issuing…" : "Issue gift card"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
