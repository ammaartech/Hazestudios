"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useField, useFields } from "@/lib/form-store";
import type { Location } from "@/lib/types";
import { cartesian, useProductStore, type ProductDraft } from "../product-draft";
import { Field, QuantityInput } from "./fields";

const KEYS = ["track_inventory", "continue_selling"] as const;

export function InventorySection({ locations }: { locations: Location[] }) {
  const store = useProductStore();
  const [sku, setSku] = useField(store, "sku");
  const [barcode, setBarcode] = useField(store, "barcode");
  const [options] = useField(store, "options");
  const [inventory] = useField(store, "inventory");
  const flags = useFields<ProductDraft, (typeof KEYS)[number]>(store, KEYS);

  // With options present, stock is per variant and lives in the variants table.
  const hasVariants = cartesian(options).length > 0;

  const total = locations.reduce((sum, l) => sum + (inventory[l.id] ?? 0), 0);

  return (
    <Card id="section-inventory" className="scroll-mt-32">
      <CardHeader>
        <CardTitle className="text-base">Inventory</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="SKU (Stock Keeping Unit)"
            optional
            hint="Your own code for this item."
          >
            {(props) => (
              <Input
                {...props}
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <Field label="Barcode (ISBN, UPC, GTIN)" optional>
            {(props) => (
              <Input
                {...props}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox
              checked={flags.track_inventory}
              onCheckedChange={(c) => store.set("track_inventory", c === true)}
            />
            Track quantity
          </label>

          {flags.track_inventory && (
            <label className="flex cursor-pointer items-center gap-2.5 pl-6 text-sm">
              <Checkbox
                checked={flags.continue_selling}
                onCheckedChange={(c) => store.set("continue_selling", c === true)}
              />
              <span>
                Continue selling when out of stock
                <span className="ml-1 text-muted-foreground">
                  — allows orders past zero
                </span>
              </span>
            </label>
          )}
        </div>

        {flags.track_inventory && !hasVariants && (
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium">Quantity by location</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {total} available
              </p>
            </div>

            {locations.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No locations yet. Add one in Settings to track stock.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-input">
                {locations.map((loc) => (
                  <li
                    key={loc.id}
                    className="flex items-center justify-between gap-4 px-3 py-2"
                  >
                    <Label
                      htmlFor={`qty-${loc.id}`}
                      className="font-normal text-muted-foreground"
                    >
                      {loc.name}
                      {loc.is_default && (
                        <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-[0.6875rem] text-secondary-foreground">
                          Default
                        </span>
                      )}
                    </Label>
                    <QuantityInput
                      id={`qty-${loc.id}`}
                      className="w-24"
                      value={inventory[loc.id] ?? 0}
                      onChange={(qty) =>
                        store.update("inventory", (prev) => ({
                          ...prev,
                          [loc.id]: qty,
                        }))
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {flags.track_inventory && hasVariants && (
          <p className="border-t border-border pt-4 text-xs text-muted-foreground">
            This product has options, so stock is set per variant in the Variants
            section below.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
