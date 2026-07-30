"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { AlertTriangle, ImageIcon, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { searchOrderProducts, type PickerProduct } from "./search-actions";

/**
 * A selectable unit is a variant, or a whole product when it has none. The key
 * identifies it in both the picker and the builder's line items, so a line can
 * be matched back to its checkbox on reopen.
 */
export function selectionKey(productId: string, variantId: string | null) {
  return `${productId}:${variantId ?? ""}`;
}

export interface PickedItem {
  key: string;
  product_id: string;
  variant_id: string | null;
  title: string;
  variant_title: string;
  price: number;
}

const SEARCH_DEBOUNCE_MS = 250;

export function ProductPicker({
  open,
  onOpenChange,
  /** Keys already on the order — pre-checked so the modal reflects the order. */
  selectedKeys,
  onConfirm,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedKeys: string[];
  /** `keys` is the full ticked set; `data` describes units ticked this session. */
  onConfirm: (keys: string[], data: Map<string, PickedItem>) => void;
  currency: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `sm:max-w-2xl`, not `max-w-2xl`: DialogContent ships `sm:max-w-sm`, and
          tailwind-merge cannot dedupe a responsive variant against a plain one,
          so a bare override loses to it above 640px and cramps the columns. */}
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Select products</DialogTitle>
        </DialogHeader>
        {/* Mounted per opening so its state initialises from the order as it is
            now. A cancelled session therefore cannot leak into the next one,
            and no effect is needed to reset anything. */}
        {open && (
          <PickerBody
            initialKeys={selectedKeys}
            currency={currency}
            onCancel={() => onOpenChange(false)}
            onConfirm={(keys, data) => {
              onConfirm(keys, data);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  initialKeys,
  currency,
  onCancel,
  onConfirm,
}: {
  initialKeys: string[];
  currency: string;
  onCancel: () => void;
  onConfirm: (keys: string[], data: Map<string, PickedItem>) => void;
}) {
  const [term, setTerm] = useState("");
  const [products, setProducts] = useState<PickerProduct[]>([]);
  const [loading, startSearch] = useTransition();
  /** What is ticked, seeded from the order this picker was opened against. */
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialKeys)
  );
  /** Data for units ticked this session; the builder already holds the rest. */
  const [data, setData] = useState<Map<string, PickedItem>>(() => new Map());

  // Results arriving out of order would otherwise let a slow early query
  // overwrite the answer to a later keystroke.
  const requestRef = useRef(0);

  const runSearch = useCallback((value: string) => {
    const request = ++requestRef.current;
    startSearch(async () => {
      const rows = await searchOrderProducts(value);
      if (request === requestRef.current) setProducts(rows);
    });
  }, []);

  // Mounting searches immediately; typing waits for the operator to stop.
  useEffect(() => {
    const id = setTimeout(() => runSearch(term), term ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(id);
  }, [term, runSearch]);

  function setUnits(units: PickedItem[], on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const u of units) {
        if (on) next.add(u.key);
        else next.delete(u.key);
      }
      return next;
    });
    if (!on) return;
    setData((prev) => {
      const next = new Map(prev);
      for (const u of units) next.set(u.key, u);
      return next;
    });
  }

  const count = checked.size;

  return (
    <>
      <div className="border-b px-5 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search products by title, vendor or SKU"
            aria-label="Search products"
            className="h-9 pl-9"
          />
        </div>
      </div>

      <div className="max-h-[52vh] min-h-72 overflow-y-auto">
        {loading && products.length === 0 ? (
          <PickerSkeleton />
        ) : products.length === 0 ? (
          <p className="px-5 py-16 text-center text-sm text-muted-foreground">
            No products match “{term}”.
          </p>
        ) : (
          <ul className={cn("divide-y", loading && "opacity-60")}>
            {products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                checked={checked}
                currency={currency}
                onSetUnits={setUnits}
              />
            ))}
          </ul>
        )}
      </div>

      <DialogFooter className="items-center justify-between border-t px-5 py-3 sm:justify-between">
        <span className="text-sm text-muted-foreground">
          {count} {count === 1 ? "variant" : "variants"} selected
        </span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm([...checked], data)}>Add</Button>
        </div>
      </DialogFooter>
    </>
  );
}

/** The selectable units a product contributes: its variants, or itself. */
function unitsOf(product: PickerProduct): PickedItem[] {
  if (product.variants.length === 0) {
    return [
      {
        key: selectionKey(product.id, null),
        product_id: product.id,
        variant_id: null,
        title: product.title,
        variant_title: "",
        price: product.price,
      },
    ];
  }
  return product.variants.map((v) => ({
    key: selectionKey(product.id, v.id),
    product_id: product.id,
    variant_id: v.id,
    title: product.title,
    variant_title: v.title,
    price: v.price,
  }));
}

function ProductRow({
  product,
  checked,
  currency,
  onSetUnits,
}: {
  product: PickerProduct;
  checked: Set<string>;
  currency: string;
  onSetUnits: (units: PickedItem[], on: boolean) => void;
}) {
  const units = unitsOf(product);
  const checkedCount = units.filter((u) => checked.has(u.key)).length;
  const allChecked = checkedCount === units.length;
  const hasVariants = product.variants.length > 0;

  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-muted/50">
        <Checkbox
          checked={allChecked ? true : checkedCount > 0 ? "indeterminate" : false}
          onCheckedChange={(v) => onSetUnits(units, Boolean(v))}
          aria-label={`Select all of ${product.title}`}
        />
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {product.cover ? (
            <Image
              src={product.cover}
              alt={product.title}
              width={40}
              height={40}
              className="size-10 object-cover"
              quality={60}
            />
          ) : (
            <ImageIcon className="size-4 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {product.title}
        </span>
        {!hasVariants && (
          <>
            <Availability value={product.available} />
            <span className="w-24 shrink-0 whitespace-nowrap text-right text-sm tabular-nums">
              {formatMoney(product.price, currency)}
            </span>
          </>
        )}
      </label>

      {hasVariants && (
        <ul>
          {product.variants.map((variant) => {
            const key = selectionKey(product.id, variant.id);
            return (
              <li key={variant.id}>
                {/* pl-18 lines the variant name up with the product title above
                    it: 20px padding + 16px checkbox + 12px gap + 40px thumb. */}
                <label className="flex cursor-pointer items-center gap-3 py-2 pl-18 pr-5 hover:bg-muted/50">
                  <Checkbox
                    checked={checked.has(key)}
                    onCheckedChange={(v) =>
                      onSetUnits(
                        [
                          {
                            key,
                            product_id: product.id,
                            variant_id: variant.id,
                            title: product.title,
                            variant_title: variant.title,
                            price: variant.price,
                          },
                        ],
                        Boolean(v)
                      )
                    }
                    aria-label={`Select ${product.title} ${variant.title}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {variant.title}
                    {variant.sku && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {variant.sku}
                      </span>
                    )}
                  </span>
                  <Availability value={variant.available} />
                  <span className="w-24 shrink-0 whitespace-nowrap text-right text-sm tabular-nums">
                    {formatMoney(variant.price, currency)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/**
 * Stock is shown because an operator creating an order by hand is the last
 * person who can catch an oversell. Zero and negative are called out — the
 * imported catalogue genuinely holds negative levels.
 */
function Availability({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
        —
      </span>
    );
  }
  const short = value <= 0;
  return (
    <span
      className={cn(
        "flex w-20 shrink-0 items-center justify-end gap-1 whitespace-nowrap text-right text-sm tabular-nums",
        short ? "text-amber-600" : "text-muted-foreground"
      )}
    >
      {short && <AlertTriangle className="size-3.5" />}
      {value}
    </span>
  );
}

function PickerSkeleton() {
  return (
    <div className="space-y-3 px-5 py-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="size-10 rounded-md" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
