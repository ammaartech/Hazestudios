"use client";

import { Fragment, useMemo, useState } from "react";
import Image from "next/image";
import { ChevronDown, ImageIcon, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagsInput } from "@/components/admin/tags-input";
import { useFields } from "@/lib/form-store";
import { currencySymbol } from "@/lib/format";
import type { Location } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  deriveVariants,
  useProductStore,
  type OptionDraft,
  type ProductDraft,
  type VariantOverride,
} from "../product-draft";
import { MoneyInput, QuantityInput } from "./fields";

const MAX_OPTIONS = 3;

const KEYS = [
  "options",
  "variantOverrides",
  "price",
  "compare_at_price",
  "cost_per_item",
  "weight",
  "images",
  "track_inventory",
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const variants = useMemo(
    () => deriveVariants({ ...store.snapshot(), ...draft } as ProductDraft),
    [store, draft]
  );

  function setOptions(next: OptionDraft[]) {
    store.set("options", next);
    setSelected(new Set());
  }

  function override(title: string, patch: Partial<VariantOverride>) {
    store.update("variantOverrides", (prev) => ({
      ...prev,
      [title]: { ...prev[title], ...patch },
    }));
  }

  function bulk(patch: (title: string) => Partial<VariantOverride>) {
    store.update("variantOverrides", (prev) => {
      const next = { ...prev };
      selected.forEach((title) => {
        next[title] = { ...next[title], ...patch(title) };
      });
      return next;
    });
  }

  const allSelected = variants.length > 0 && selected.size === variants.length;

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
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draft.options.length >= MAX_OPTIONS}
          title={
            draft.options.length >= MAX_OPTIONS
              ? "A product can have at most three options"
              : undefined
          }
          onClick={() =>
            setOptions([
              ...draft.options,
              { key: crypto.randomUUID(), name: "", values: [] },
            ])
          }
        >
          <Plus className="size-3.5" />
          Add option
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {draft.options.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Add an option like Size or Colour to sell this product in several
            versions. Each combination becomes its own variant with its own
            price, SKU, and stock.
          </p>
        )}

        {draft.options.map((opt, i) => (
          <div
            key={opt.key}
            className="space-y-3 rounded-lg border border-input p-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200"
          >
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`opt-name-${opt.key}`} className="text-xs">
                  Option {i + 1} name
                </Label>
                <Input
                  id={`opt-name-${opt.key}`}
                  value={opt.name}
                  placeholder="Size"
                  autoComplete="off"
                  onChange={(e) =>
                    setOptions(
                      draft.options.map((o) =>
                        o.key === opt.key ? { ...o, name: e.target.value } : o
                      )
                    )
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove option ${opt.name || i + 1}`}
                onClick={() =>
                  setOptions(draft.options.filter((o) => o.key !== opt.key))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Values</Label>
              <TagsInput
                value={opt.values}
                placeholder="Small, Medium, Large"
                onChange={(values) =>
                  setOptions(
                    draft.options.map((o) =>
                      o.key === opt.key ? { ...o, values } : o
                    )
                  )
                }
              />
            </div>
          </div>
        ))}

        {variants.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Editing one location at a time keeps the table narrow; the
                  other locations' counts are preserved, not overwritten. */}
              {locations.length > 1 && draft.track_inventory && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="variant-location" className="text-xs">
                    Stock at
                  </Label>
                  <Select value={locationId} onValueChange={setLocationId}>
                    <SelectTrigger id="variant-location" size="sm" className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selected.size > 0 && (
                <div className="ml-auto flex items-center gap-2 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {selected.size} selected
                  </span>
                  <BulkEdit
                    label="Set price"
                    symbol={symbol}
                    onApply={(v) => bulk(() => ({ price: v }))}
                  />
                  {draft.track_inventory && (
                    <BulkEdit
                      label="Set quantity"
                      numeric
                      onApply={(v) =>
                        bulk((title) => ({
                          inventory: {
                            ...(draft.variantOverrides[title]?.inventory ?? {}),
                            [locationId]: Number(v) || 0,
                          },
                        }))
                      }
                    />
                  )}
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-input">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th scope="col" className="w-10 px-3 py-2">
                      <Checkbox
                        aria-label="Select all variants"
                        checked={allSelected}
                        onCheckedChange={(c) =>
                          setSelected(
                            c === true
                              ? new Set(variants.map((v) => v.title))
                              : new Set()
                          )
                        }
                      />
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">Variant</th>
                    <th scope="col" className="px-3 py-2 font-medium">Price</th>
                    <th scope="col" className="px-3 py-2 font-medium">SKU</th>
                    {draft.track_inventory && (
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Available
                      </th>
                    )}
                    <th scope="col" className="w-10 px-3 py-2">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => {
                    const isOpen = expanded === v.title;
                    const image = draft.images.find((i) => i.id === v.image_id);
                    return (
                      <Fragment key={v.title}>
                        <tr
                          className={cn(
                            "border-b border-border last:border-0 transition-colors duration-100",
                            selected.has(v.title) && "bg-accent/50",
                            !v.available && "opacity-55"
                          )}
                        >
                          <td className="px-3 py-2">
                            <Checkbox
                              aria-label={`Select ${v.title}`}
                              checked={selected.has(v.title)}
                              onCheckedChange={(c) =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (c === true) next.add(v.title);
                                  else next.delete(v.title);
                                  return next;
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-input bg-muted">
                                {image ? (
                                  <Image
                                    src={image.url}
                                    alt=""
                                    width={28}
                                    height={28}
                                    className="size-full object-cover"
                                    unoptimized
                                  />
                                ) : (
                                  <ImageIcon className="size-3.5 text-muted-foreground" />
                                )}
                              </span>
                              <span className="font-medium">{v.title}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <MoneyInput
                              aria-label={`Price for ${v.title}`}
                              className="w-28"
                              symbol={symbol}
                              value={v.price}
                              onChange={(price) => override(v.title, { price })}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              aria-label={`SKU for ${v.title}`}
                              className="w-32 font-mono"
                              spellCheck={false}
                              value={v.sku}
                              onChange={(e) =>
                                override(v.title, { sku: e.target.value })
                              }
                            />
                          </td>
                          {draft.track_inventory && (
                            <td className="px-3 py-2">
                              <QuantityInput
                                aria-label={`Quantity for ${v.title}`}
                                className="ml-auto w-20"
                                value={v.inventory[locationId] ?? 0}
                                onChange={(qty) =>
                                  override(v.title, {
                                    inventory: { ...v.inventory, [locationId]: qty },
                                  })
                                }
                              />
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? "Hide" : "Show"} details for ${v.title}`}
                              onClick={() => setExpanded(isOpen ? null : v.title)}
                            >
                              <ChevronDown
                                className={cn(
                                  "size-4 transition-transform duration-200 motion-reduce:transition-none",
                                  isOpen && "rotate-180"
                                )}
                              />
                            </Button>
                          </td>
                        </tr>

                        {isOpen && (
                          <tr className="border-b border-border bg-muted/30">
                            <td colSpan={draft.track_inventory ? 6 : 5} className="px-3 py-3">
                              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <div className="space-y-1.5">
                                  <Label className="text-xs">Compare-at price</Label>
                                  <MoneyInput
                                    aria-label={`Compare-at price for ${v.title}`}
                                    symbol={symbol}
                                    value={v.compare_at_price}
                                    onChange={(compare_at_price) =>
                                      override(v.title, { compare_at_price })
                                    }
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-xs">Cost per item</Label>
                                  <MoneyInput
                                    aria-label={`Cost per item for ${v.title}`}
                                    symbol={symbol}
                                    value={v.cost_per_item}
                                    onChange={(cost_per_item) =>
                                      override(v.title, { cost_per_item })
                                    }
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-xs">Barcode</Label>
                                  <Input
                                    aria-label={`Barcode for ${v.title}`}
                                    className="font-mono"
                                    spellCheck={false}
                                    value={v.barcode}
                                    onChange={(e) =>
                                      override(v.title, { barcode: e.target.value })
                                    }
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor={`vimg-${v.title}`} className="text-xs">
                                    Image
                                  </Label>
                                  <Select
                                    value={v.image_id ?? "none"}
                                    onValueChange={(id) =>
                                      override(v.title, {
                                        image_id: id === "none" ? null : id,
                                      })
                                    }
                                  >
                                    <SelectTrigger id={`vimg-${v.title}`} className="w-full">
                                      <SelectValue placeholder="None" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">None</SelectItem>
                                      {draft.images.map((img, idx) => (
                                        <SelectItem key={img.id} value={img.id}>
                                          {img.alt || `Image ${idx + 1}`}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-sm">
                                <Checkbox
                                  checked={v.available}
                                  onCheckedChange={(c) =>
                                    override(v.title, { available: c === true })
                                  }
                                />
                                Available for sale
                              </label>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {draft.options.length > 0 && variants.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Add at least one value to each option to generate variants.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Small popover editor for applying one value across the selection. */
function BulkEdit({
  label,
  symbol,
  numeric,
  onApply,
}: {
  label: string;
  symbol?: string;
  numeric?: boolean;
  onApply: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  function apply() {
    onApply(value);
    setValue("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-2 p-2">
        {numeric ? (
          <Input
            autoFocus
            inputMode="numeric"
            placeholder="0"
            aria-label={label}
            className="text-right tabular-nums"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && apply()}
          />
        ) : (
          <MoneyInput
            autoFocus
            aria-label={label}
            symbol={symbol}
            value={value}
            onChange={setValue}
            onKeyDown={(e) => e.key === "Enter" && apply()}
          />
        )}
        <Button type="button" size="sm" className="w-full" onClick={apply}>
          Apply to selected
        </Button>
      </PopoverContent>
    </Popover>
  );
}
