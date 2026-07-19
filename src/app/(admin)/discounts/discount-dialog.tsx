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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Discount, DiscountType } from "@/lib/types";
import { saveDiscount } from "./actions";

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DiscountDialog({ discount }: { discount?: Discount }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(discount?.code ?? "");
  const [type, setType] = useState<DiscountType>(discount?.type ?? "percentage");
  const [value, setValue] = useState(
    discount != null ? String(discount.value) : ""
  );
  const [minPurchase, setMinPurchase] = useState(
    discount?.min_purchase != null ? String(discount.min_purchase) : ""
  );
  const [usageLimit, setUsageLimit] = useState(
    discount?.usage_limit != null ? String(discount.usage_limit) : ""
  );
  const [oncePerCustomer, setOncePerCustomer] = useState(
    discount?.once_per_customer ?? false
  );
  const [startsAt, setStartsAt] = useState(
    toLocalInput(discount?.starts_at ?? new Date().toISOString())
  );
  const [endsAt, setEndsAt] = useState(toLocalInput(discount?.ends_at ?? null));
  const [pending, startTransition] = useTransition();

  const needsValue = type === "percentage" || type === "fixed";

  function handleSave() {
    startTransition(async () => {
      const result = await saveDiscount({
        id: discount?.id,
        code,
        type,
        value: needsValue ? parseFloat(value) || 0 : 0,
        min_purchase: minPurchase ? parseFloat(minPurchase) : null,
        usage_limit: usageLimit ? parseInt(usageLimit) : null,
        once_per_customer: oncePerCustomer,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(discount ? "Discount updated" : "Discount created");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {discount ? (
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        ) : (
          <Button>Create discount</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {discount ? "Edit discount" : "Create discount"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="disc-code">Discount code</Label>
            <Input
              id="disc-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SUMMER10"
              className="font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as DiscountType)}>
                <SelectTrigger aria-label="Discount type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                  <SelectItem value="free_shipping">Free shipping</SelectItem>
                  <SelectItem value="bxgy">Buy X get Y</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {needsValue && (
              <div className="space-y-2">
                <Label htmlFor="disc-value">
                  {type === "percentage" ? "Percentage off" : "Amount off"}
                </Label>
                <Input
                  id="disc-value"
                  type="number"
                  min="0"
                  step={type === "percentage" ? "1" : "0.01"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={type === "percentage" ? "10" : "5.00"}
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="disc-min">Minimum purchase</Label>
              <Input
                id="disc-min"
                type="number"
                min="0"
                step="0.01"
                value={minPurchase}
                onChange={(e) => setMinPurchase(e.target.value)}
                placeholder="No minimum"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="disc-limit">Usage limit</Label>
              <Input
                id="disc-limit"
                type="number"
                min="1"
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value)}
                placeholder="Unlimited"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="disc-start">Starts</Label>
              <Input
                id="disc-start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="disc-end">Ends (optional)</Label>
              <Input
                id="disc-end"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={oncePerCustomer}
              onCheckedChange={(v) => setOncePerCustomer(Boolean(v))}
            />
            Limit to one use per customer
          </label>
          <Button
            onClick={handleSave}
            disabled={pending || !code.trim()}
            className="w-full"
          >
            {pending ? "Saving…" : "Save discount"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
