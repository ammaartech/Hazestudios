"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/admin/page-header";
import { formatMoney } from "@/lib/format";
import type { Customer, Product, ProductVariant } from "@/lib/types";
import { createOrder, type OrderItemPayload } from "../actions";

type ProductWithVariants = Product & { product_variants: ProductVariant[] };

interface LineItem extends OrderItemPayload {
  key: string;
}

export function OrderBuilder({
  products,
  customers,
}: {
  products: ProductWithVariants[];
  customers: Customer[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [customerId, setCustomerId] = useState<string>("none");
  const [items, setItems] = useState<LineItem[]>([]);
  const [note, setNote] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [markAsPaid, setMarkAsPaid] = useState(false);
  const [pickerProduct, setPickerProduct] = useState<string>("");
  const [pickerVariant, setPickerVariant] = useState<string>("");

  const selectedProduct = products.find((p) => p.id === pickerProduct);
  const variants = selectedProduct?.product_variants ?? [];

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items]
  );

  function addItem() {
    if (!selectedProduct) return;
    const variant =
      variants.length > 0
        ? variants.find((v) => v.id === pickerVariant)
        : undefined;
    if (variants.length > 0 && !variant) {
      toast.error("Pick a variant");
      return;
    }
    setItems([
      ...items,
      {
        key: crypto.randomUUID(),
        product_id: selectedProduct.id,
        variant_id: variant?.id ?? null,
        title: selectedProduct.title,
        variant_title: variant?.title ?? "",
        price: Number(variant?.price ?? selectedProduct.price),
        quantity: 1,
      },
    ]);
    setPickerProduct("");
    setPickerVariant("");
  }

  function submit(isDraft: boolean) {
    startTransition(async () => {
      const result = await createOrder({
        customer_id: customerId === "none" ? null : customerId,
        is_draft: isDraft,
        mark_as_paid: markAsPaid,
        note,
        discount_code: discountCode,
        items: items.map(({ key: _key, ...rest }) => rest),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(isDraft ? "Draft saved" : "Order created");
      router.push(isDraft ? "/admin/orders/drafts" : `/orders/${result.id}`);
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
            <CardHeader>
              <CardTitle className="text-base">Products</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1 space-y-2">
                  <Label>Product</Label>
                  <Select
                    value={pickerProduct}
                    onValueChange={(v) => {
                      setPickerProduct(v);
                      setPickerVariant("");
                    }}
                  >
                    <SelectTrigger aria-label="Pick a product">
                      <SelectValue placeholder="Pick a product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {variants.length > 0 && (
                  <div className="min-w-40 space-y-2">
                    <Label>Variant</Label>
                    <Select value={pickerVariant} onValueChange={setPickerVariant}>
                      <SelectTrigger aria-label="Pick a variant">
                        <SelectValue placeholder="Variant" />
                      </SelectTrigger>
                      <SelectContent>
                        {variants.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.title} — {formatMoney(Number(v.price))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={addItem}
                  disabled={!pickerProduct}
                >
                  <Plus className="size-4" />
                  Add
                </Button>
              </div>

              {items.length > 0 && (
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
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {formatMoney(item.price)}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min="1"
                              aria-label={`Quantity for ${item.title}`}
                              className="h-8 w-20"
                              value={item.quantity}
                              onChange={(e) =>
                                setItems(
                                  items.map((i) =>
                                    i.key === item.key
                                      ? {
                                          ...i,
                                          quantity: Math.max(
                                            1,
                                            parseInt(e.target.value) || 1
                                          ),
                                        }
                                      : i
                                  )
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {formatMoney(item.price * item.quantity)}
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove ${item.title}`}
                              onClick={() =>
                                setItems(items.filter((i) => i.key !== item.key))
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
                <span className="tabular-nums">{formatMoney(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="discount-code" className="text-muted-foreground">
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
              <div className="flex justify-between border-t pt-3 text-sm font-semibold">
                <span>Total (before discount)</span>
                <span className="tabular-nums">{formatMoney(subtotal)}</span>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                aria-label="Order note"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
