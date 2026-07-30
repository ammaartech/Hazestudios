"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CharCount } from "@/components/admin/char-count";
import { PageHeader } from "@/components/admin/page-header";
import { currencySymbol, formatMoney } from "@/lib/format";
import { createOrder } from "../actions";
import { CustomerPicker } from "./customer-picker";
import { CustomItemDialog } from "./custom-item-dialog";
import { ProductPicker, type PickedItem } from "./product-picker";
import type { PickerCustomer } from "./search-actions";

/**
 * `orders.note` is an unbounded `text` column, so this cap is a product choice
 * rather than a schema limit — and it is enforced on the textarea so the count
 * states a real ceiling instead of a suggestion nothing downstream checks.
 */
const NOTE_MAX = 1000;

interface LineItem {
  key: string;
  product_id: string | null;
  variant_id: string | null;
  title: string;
  variant_title: string;
  price: number;
  quantity: number;
  /** Custom lines have no catalogue entry, so the picker never owns them. */
  custom: boolean;
}

export function OrderBuilder({ currency }: { currency: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [customer, setCustomer] = useState<PickerCustomer | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [note, setNote] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [shipping, setShipping] = useState("");
  const [markAsPaid, setMarkAsPaid] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [customItemOpen, setCustomItemOpen] = useState(false);

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items]
  );
  const shippingTotal = Math.max(0, Number(shipping) || 0);
  const total = subtotal + shippingTotal;

  /** Keys the picker should show as already ticked. */
  const selectedKeys = useMemo(
    () => items.filter((i) => !i.custom).map((i) => i.key),
    [items]
  );

  /**
   * Reconciles the picker's result against the current lines: quantities on
   * kept lines survive, unticked lines go, newly ticked ones arrive at qty 1.
   * Custom lines are never in the picker's world, so they always stay.
   */
  function applyPicker(keys: string[], data: Map<string, PickedItem>) {
    const ticked = new Set(keys);
    setItems((prev) => {
      const kept = prev.filter((i) => i.custom || ticked.has(i.key));
      const present = new Set(kept.filter((i) => !i.custom).map((i) => i.key));
      const added: LineItem[] = keys
        .filter((k) => !present.has(k))
        .map((k) => data.get(k))
        .filter((p): p is PickedItem => Boolean(p))
        .map((p) => ({ ...p, quantity: 1, custom: false }));
      return [...kept, ...added];
    });
  }

  function addCustomItem(item: {
    title: string;
    price: number;
    quantity: number;
  }) {
    setItems((prev) => [
      ...prev,
      {
        key: `custom:${crypto.randomUUID()}`,
        product_id: null,
        variant_id: null,
        title: item.title,
        variant_title: "",
        price: item.price,
        quantity: item.quantity,
        custom: true,
      },
    ]);
  }

  function setQuantity(key: string, raw: string) {
    const quantity = Math.max(1, parseInt(raw, 10) || 1);
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, quantity } : i))
    );
  }

  function submit(isDraft: boolean) {
    startTransition(async () => {
      const result = await createOrder({
        customer_id: customer?.id ?? null,
        is_draft: isDraft,
        mark_as_paid: markAsPaid,
        note,
        discount_code: discountCode,
        shipping_total: shippingTotal,
        // `key` and `custom` are builder bookkeeping; the action takes neither.
        items: items.map((i) => ({
          product_id: i.product_id,
          variant_id: i.variant_id,
          title: i.title,
          variant_title: i.variant_title,
          price: i.price,
          quantity: i.quantity,
        })),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(isDraft ? "Draft saved" : "Order created");
      router.push(isDraft ? "/admin/orders/drafts" : `/admin/orders/${result.id}`);
      router.refresh();
    });
  }

  return (
    <div>
      <PageHeader title="Create order" backHref="/admin/orders" backLabel="Orders">
        <Button
          variant="outline"
          onClick={() => submit(true)}
          disabled={pending || !items.length}
        >
          Save as draft
        </Button>
        <Button onClick={() => submit(false)} disabled={pending || !items.length}>
          {pending ? "Creating…" : "Create order"}
        </Button>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Products</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setProductPickerOpen(true)}
                >
                  <Plus className="size-4" />
                  Add product
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCustomItemOpen(true)}
                >
                  <Plus className="size-4" />
                  Add custom item
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-12 text-center">
                  <Package className="size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No products yet. Search the catalogue to build this order.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setProductPickerOpen(true)}
                  >
                    Add product
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border border-input">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left">
                        <th className="px-3 py-2 font-medium">Item</th>
                        <th className="px-3 py-2 font-medium">Price</th>
                        <th className="px-3 py-2 font-medium">Qty</th>
                        <th className="px-3 py-2 font-medium">Total</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.key} className="border-b last:border-0">
                          <td className="px-3 py-2">
                            <span className="font-medium">{item.title}</span>
                            {item.variant_title && (
                              <span className="block text-xs text-muted-foreground">
                                {item.variant_title}
                              </span>
                            )}
                            {item.custom && (
                              <span className="block text-xs text-muted-foreground">
                                Custom item
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {formatMoney(item.price, currency)}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min="1"
                              aria-label={`Quantity for ${item.title}`}
                              className="h-8 w-20"
                              value={item.quantity}
                              onChange={(e) =>
                                setQuantity(item.key, e.target.value)
                              }
                            />
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {formatMoney(item.price * item.quantity, currency)}
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove ${item.title}`}
                              onClick={() =>
                                setItems((prev) =>
                                  prev.filter((i) => i.key !== item.key)
                                )
                              }
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">
                  {formatMoney(subtotal, currency)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 text-sm">
                <Label
                  htmlFor="discount-code"
                  className="font-normal text-muted-foreground"
                >
                  Discount code
                </Label>
                <Input
                  id="discount-code"
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value)}
                  placeholder="Optional"
                  className="h-8 w-40"
                />
              </div>

              <div className="flex items-center justify-between gap-3 text-sm">
                <Label
                  htmlFor="shipping-total"
                  className="font-normal text-muted-foreground"
                >
                  Shipping
                </Label>
                <div className="relative w-40">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {currencySymbol(currency)}
                  </span>
                  <Input
                    id="shipping-total"
                    value={shipping}
                    onChange={(e) => setShipping(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-8 pl-7"
                  />
                </div>
              </div>

              <div className="flex justify-between border-t pt-3 text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">
                  {formatMoney(total, currency)}
                </span>
              </div>
              {/* The code is validated server-side, where the discount rules
                  live — so the deduction only appears on the created order. */}
              {discountCode.trim() && (
                <p className="text-xs text-muted-foreground">
                  Discount is applied when the order is created.
                </p>
              )}

              <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm">
                <Checkbox
                  checked={markAsPaid}
                  onCheckedChange={(v) => setMarkAsPaid(Boolean(v))}
                />
                Mark as paid
              </label>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomerPicker value={customer} onChange={setCustomer} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                maxLength={NOTE_MAX}
                aria-label="Order note"
              />
              <div className="flex justify-end">
                <CharCount value={note} max={NOTE_MAX} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ProductPicker
        open={productPickerOpen}
        onOpenChange={setProductPickerOpen}
        selectedKeys={selectedKeys}
        onConfirm={applyPicker}
        currency={currency}
      />
      <CustomItemDialog
        open={customItemOpen}
        onOpenChange={setCustomItemOpen}
        onAdd={addCustomItem}
        currency={currency}
      />
    </div>
  );
}
