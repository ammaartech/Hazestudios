"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currencySymbol } from "@/lib/format";

/**
 * A line that is not in the catalogue — a repair fee, a bespoke commission, the
 * cash-on-delivery surcharge. `order_items.product_id` is nullable precisely so
 * these can exist, and the import already relies on it.
 */
export function CustomItemDialog({
  open,
  onOpenChange,
  onAdd,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: { title: string; price: number; quantity: number }) => void;
  currency: string;
}) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");

  const parsedPrice = Number(price);
  const parsedQty = parseInt(quantity, 10);
  const valid =
    title.trim().length > 0 &&
    Number.isFinite(parsedPrice) &&
    parsedPrice >= 0 &&
    price.trim() !== "" &&
    Number.isFinite(parsedQty) &&
    parsedQty >= 1;

  function reset() {
    setTitle("");
    setPrice("");
    setQuantity("1");
  }

  function submit() {
    if (!valid) return;
    onAdd({ title: title.trim(), price: parsedPrice, quantity: parsedQty });
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add custom item</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="custom-title">Item name</Label>
            <Input
              id="custom-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Alteration charge"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="custom-price">Price</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {currencySymbol(currency)}
                </span>
                <Input
                  id="custom-price"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-qty">Quantity</Label>
              <Input
                id="custom-qty"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            Add item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
