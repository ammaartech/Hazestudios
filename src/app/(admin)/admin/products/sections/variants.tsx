"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFields } from "@/lib/form-store";
import { currencySymbol } from "@/lib/format";
import type { Location } from "@/lib/types";
import {
  activeOptions,
  deriveVariants,
  remapOverrides,
  useProductStore,
  type OptionDraft,
  type ProductDraft,
  type VariantOverride,
  type VariantRow,
} from "../product-draft";
import { OptionEditor, type ValueRenames } from "./variant-options";
import { VariantBulkEditor } from "./variant-bulk-editor";
import { VariantTable } from "./variant-table";

const MAX_OPTIONS = 3;

const KEYS = [
  "title",
  "options",
  "variantOverrides",
  "price",
  "compare_at_price",
  "cost_per_item",
  "weight",
  "images",
  "track_inventory",
  "requires_shipping",
] as const;

export function VariantsSection({
  locations,
  currency = "USD",
}: {
  locations: Location[];
  currency?: string;
}) {
  const store = useProductStore();
  const draft = useFields<ProductDraft, (typeof KEYS)[number]>(store, KEYS);
  const symbol = currencySymbol(currency);

  const [locationId, setLocationId] = useState(
    () => locations.find((l) => l.is_default)?.id ?? locations[0]?.id ?? ""
  );
  /** titles being edited in the spreadsheet overlay; null when it is closed */
  const [bulkTitles, setBulkTitles] = useState<string[] | null>(null);

  const variants = useMemo(
    () => deriveVariants({ ...store.snapshot(), ...draft } as ProductDraft),
    [store, draft]
  );

  const named = useMemo(() => activeOptions(draft.options), [draft.options]);

  /**
   * The single entry point for every structural change to the options, so
   * per-variant edits are carried across the rename/reorder/insert in one
   * place instead of being silently dropped by whichever handler forgot.
   */
  function commitOptions(next: OptionDraft[], renames?: ValueRenames) {
    const from = store.get("options");
    store.set("options", next);
    store.set(
      "variantOverrides",
      remapOverrides(store.get("variantOverrides"), from, next, renames)
    );
  }

  function override(title: string, patch: Partial<VariantOverride>) {
    store.update("variantOverrides", (prev) => ({
      ...prev,
      [title]: { ...prev[title], ...patch },
    }));
  }

  function bulk(titles: string[], patch: (row: VariantRow) => Partial<VariantOverride>) {
    const byTitle = new Map(variants.map((v) => [v.title, v]));
    store.update("variantOverrides", (prev) => {
      const next = { ...prev };
      for (const title of titles) {
        const row = byTitle.get(title);
        if (row) next[title] = { ...next[title], ...patch(row) };
      }
      return next;
    });
  }

  const bulkRows = useMemo(
    () =>
      bulkTitles === null
        ? []
        : variants.filter((v) => bulkTitles.includes(v.title)),
    [bulkTitles, variants]
  );

  return (
    <Card id="section-variants" className="scroll-mt-32">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">
          Variants
          {variants.length > 0 && (
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {variants.length}
            </span>
          )}
        </CardTitle>
        {variants.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setBulkTitles(variants.map((v) => v.title))}
          >
            Bulk edit
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {draft.options.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Add an option like Size or Colour to sell this product in several
            versions. Each combination becomes its own variant with its own
            price, SKU, and stock.
          </p>
        )}

        <OptionEditor
          options={draft.options}
          onChange={commitOptions}
          max={MAX_OPTIONS}
        />

        {variants.length > 0 ? (
          <VariantTable
            variants={variants}
            options={named}
            images={draft.images}
            locations={locations}
            locationId={locationId}
            onLocationChange={setLocationId}
            symbol={symbol}
            trackInventory={draft.track_inventory}
            onOverride={override}
            onBulk={bulk}
            onBulkEdit={setBulkTitles}
          />
        ) : (
          draft.options.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Add at least one value to each option to generate variants.
            </p>
          )
        )}
      </CardContent>

      {bulkTitles !== null && bulkRows.length > 0 && (
        <VariantBulkEditor
          rows={bulkRows}
          images={draft.images}
          locations={locations}
          symbol={symbol}
          trackInventory={draft.track_inventory}
          requiresShipping={draft.requires_shipping}
          productTitle={draft.title}
          onOverride={override}
          onClose={() => setBulkTitles(null)}
        />
      )}
    </Card>
  );
}
