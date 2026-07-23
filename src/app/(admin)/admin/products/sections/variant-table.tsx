"use client";

import { Fragment, useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  ImageIcon,
  ImagePlus,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import type { DraftImage } from "@/components/admin/media-uploader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { isColorOption, swatchFor } from "@/lib/variant-presets";
import type { Location } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { OptionDraft, VariantOverride, VariantRow } from "../product-draft";
import { MoneyInput, QuantityInput } from "./fields";

type SortKey = "manual" | "title" | "price" | "stock";
type SortDirection = "asc" | "desc";

export interface VariantTableProps {
  variants: VariantRow[];
  /** named options with values, in display order */
  options: OptionDraft[];
  images: DraftImage[];
  locations: Location[];
  locationId: string;
  onLocationChange: (id: string) => void;
  symbol: string;
  trackInventory: boolean;
  onOverride: (title: string, patch: Partial<VariantOverride>) => void;
  onBulk: (titles: string[], patch: (row: VariantRow) => Partial<VariantOverride>) => void;
  onBulkEdit: (titles: string[]) => void;
}

/** The value a row takes for the option at `index`. */
function valueAt(row: VariantRow, index: number): string {
  return [row.option1, row.option2, row.option3][index] ?? "";
}

export function VariantTable({
  variants,
  options,
  images,
  locations,
  locationId,
  onLocationChange,
  symbol,
  trackInventory,
  onOverride,
  onBulk,
  onBulkEdit,
}: VariantTableProps) {
  // Grouping by the first option is Shopify's default and the right one: the
  // first option is the one the operator chose to lead with.
  const [groupBy, setGroupBy] = useState<string>(() =>
    options.length > 1 ? options[0].key : "none"
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("manual");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  // An option can be removed while it is the grouping key; fall back rather
  // than render an empty table.
  const groupIndex = options.findIndex((o) => o.key === groupBy);
  const grouped = groupIndex >= 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? variants.filter(
          (v) =>
            v.title.toLowerCase().includes(q) ||
            v.sku.toLowerCase().includes(q)
        )
      : variants;

    if (sort === "manual") return rows;

    const sign = direction === "asc" ? 1 : -1;
    const stock = (v: VariantRow) => v.inventory[locationId] ?? 0;
    return [...rows].sort((a, b) => {
      switch (sort) {
        case "price":
          return sign * (Number(a.price || 0) - Number(b.price || 0));
        case "stock":
          return sign * (stock(a) - stock(b));
        default:
          return sign * a.title.localeCompare(b.title, undefined, { numeric: true });
      }
    });
  }, [variants, query, sort, direction, locationId]);

  const groups = useMemo(() => {
    if (!grouped) return [{ key: "__all", label: "", rows: filtered }];
    const map = new Map<string, VariantRow[]>();
    // Seeded from the option's own value order so groups appear in the order
    // the operator arranged the chips, not in first-seen order.
    for (const value of options[groupIndex].values) map.set(value, []);
    for (const row of filtered) {
      const value = valueAt(row, groupIndex);
      const bucket = map.get(value);
      if (bucket) bucket.push(row);
      else map.set(value, [row]);
    }
    return [...map.entries()]
      .filter(([, rows]) => rows.length > 0)
      .map(([label, rows]) => ({ key: label, label, rows }));
  }, [filtered, grouped, groupIndex, options]);

  const visibleTitles = useMemo(() => filtered.map((v) => v.title), [filtered]);
  const selectedTitles = useMemo(
    () => visibleTitles.filter((t) => selected.has(t)),
    [visibleTitles, selected]
  );

  const allSelected =
    visibleTitles.length > 0 && selectedTitles.length === visibleTitles.length;
  const someSelected = selectedTitles.length > 0 && !allSelected;

  function toggle(titles: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      titles.forEach((t) => (on ? next.add(t) : next.delete(t)));
      return next;
    });
  }

  const totalStock = variants.reduce(
    (sum, v) => sum + (v.inventory[locationId] ?? 0),
    0
  );
  const locationName =
    locations.find((l) => l.id === locationId)?.name ?? "this location";

  const columnCount = trackInventory ? 6 : 5;

  return (
    <div className="space-y-2">
      {/* Toolbar — swaps to the selection bar so the two never compete for the
          same row of space, which is what makes the selected state obvious. */}
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        {selectedTitles.length > 0 ? (
          <>
            <Checkbox
              aria-label="Clear selection"
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={() => setSelected(new Set())}
            />
            <span className="text-sm font-medium tabular-nums">
              {selectedTitles.length} selected
            </span>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onBulkEdit(selectedTitles)}
              >
                Bulk edit
              </Button>
              <BulkValue
                label="Set price"
                symbol={symbol}
                onApply={(price) => onBulk(selectedTitles, () => ({ price }))}
              />
              {trackInventory && (
                <BulkValue
                  label="Set quantity"
                  numeric
                  onApply={(value) =>
                    onBulk(selectedTitles, (row) => ({
                      inventory: { ...row.inventory, [locationId]: Number(value) || 0 },
                    }))
                  }
                />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="More bulk actions"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() =>
                      onBulk(selectedTitles, () => ({ available: true }))
                    }
                  >
                    Make available for sale
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() =>
                      onBulk(selectedTitles, () => ({ available: false }))
                    }
                  >
                    Make unavailable
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => onBulk(selectedTitles, () => ({ image_id: null }))}
                  >
                    Remove image
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() =>
                      onBulk(selectedTitles, () => ({
                        price: undefined,
                        compare_at_price: undefined,
                        cost_per_item: undefined,
                        weight: undefined,
                      }))
                    }
                  >
                    Reset to product pricing
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        ) : (
          <>
            {options.length > 0 && (
              <div className="flex items-center gap-2">
                <Label htmlFor="variant-group" className="text-xs">
                  Group by
                </Label>
                <Select value={grouped ? groupBy : "none"} onValueChange={setGroupBy}>
                  <SelectTrigger id="variant-group" size="sm" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {options.map((o) => (
                      <SelectItem key={o.key} value={o.key}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {locations.length > 1 && trackInventory && (
              <div className="flex items-center gap-2">
                <Label htmlFor="variant-location" className="text-xs">
                  Stock at
                </Label>
                <Select value={locationId} onValueChange={onLocationChange}>
                  <SelectTrigger id="variant-location" size="sm" className="w-44">
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

            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search variants"
                  aria-label="Search variants"
                  className="h-7 w-44 pl-7 text-[0.8rem]"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="Sort variants"
                  >
                    <ArrowDownUp className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={sort}
                    onValueChange={(v) => setSort(v as SortKey)}
                  >
                    <DropdownMenuRadioItem value="manual">
                      Option order
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="title">Name</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="price">Price</DropdownMenuRadioItem>
                    {trackInventory && (
                      <DropdownMenuRadioItem value="stock">
                        Available
                      </DropdownMenuRadioItem>
                    )}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={direction}
                    onValueChange={(v) => setDirection(v as SortDirection)}
                  >
                    <DropdownMenuRadioItem value="asc" disabled={sort === "manual"}>
                      Ascending
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="desc" disabled={sort === "manual"}>
                      Descending
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-input">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left">
              <th scope="col" className="w-10 px-3 py-2">
                <Checkbox
                  aria-label="Select all variants"
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(c) => {
                    if (c === true) setSelected(new Set(visibleTitles));
                    else setSelected(new Set());
                  }}
                />
              </th>
              <th scope="col" className="px-3 py-2 font-medium">Variant</th>
              <th scope="col" className="px-3 py-2 font-medium">Price</th>
              <th scope="col" className="px-3 py-2 font-medium">SKU</th>
              {trackInventory && (
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
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  No variants match “{query}”.
                </td>
              </tr>
            )}

            {groups.map((group) => {
              const titles = group.rows.map((r) => r.title);
              const groupSelected = titles.filter((t) => selected.has(t));
              const isCollapsed = collapsed.has(group.key);
              const prices = new Set(group.rows.map((r) => r.price));
              const sharedPrice = prices.size === 1 ? [...prices][0] : "";
              const groupStock = group.rows.reduce(
                (sum, r) => sum + (r.inventory[locationId] ?? 0),
                0
              );
              const swatch =
                grouped && isColorOption(options[groupIndex].name)
                  ? swatchFor(group.label)
                  : null;
              const groupImage = images.find(
                (i) => i.id === group.rows.find((r) => r.image_id)?.image_id
              );

              return (
                <Fragment key={group.key}>
                  {grouped && (
                    <tr
                      className={cn(
                        "border-b border-border transition-colors duration-100",
                        groupSelected.length === titles.length && "bg-accent/40"
                      )}
                    >
                      <td className="px-3 py-2">
                        <Checkbox
                          aria-label={`Select all ${group.label} variants`}
                          checked={
                            groupSelected.length === titles.length
                              ? true
                              : groupSelected.length > 0
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={(c) => toggle(titles, c === true)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            aria-expanded={!isCollapsed}
                            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${group.label}`}
                            onClick={() =>
                              setCollapsed((prev) => {
                                const next = new Set(prev);
                                if (next.has(group.key)) next.delete(group.key);
                                else next.add(group.key);
                                return next;
                              })
                            }
                            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                          >
                            <ChevronRight
                              className={cn(
                                "size-4 transition-transform duration-200 motion-reduce:transition-none",
                                !isCollapsed && "rotate-90"
                              )}
                            />
                          </button>

                          <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-input bg-muted">
                            {groupImage ? (
                              <Image
                                src={groupImage.url}
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

                          <span className="flex min-w-0 items-center gap-2">
                            {swatch && (
                              <span
                                aria-hidden
                                className="size-3 shrink-0 rounded-[3px] border border-foreground/15"
                                style={{ background: swatch }}
                              />
                            )}
                            <span className="truncate font-medium">{group.label}</span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                              {group.rows.length}{" "}
                              {group.rows.length === 1 ? "variant" : "variants"}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <MoneyInput
                          aria-label={`Price for all ${group.label} variants`}
                          className="w-28"
                          symbol={symbol}
                          placeholder={prices.size > 1 ? "Multiple" : "0.00"}
                          value={sharedPrice}
                          onChange={(price) => onBulk(titles, () => ({ price }))}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        —
                      </td>
                      {trackInventory && (
                        <td className="px-3 py-2 text-right text-sm text-muted-foreground tabular-nums">
                          {groupStock}
                        </td>
                      )}
                      <td className="px-3 py-2" />
                    </tr>
                  )}

                  {!isCollapsed &&
                    group.rows.map((row) => (
                      <VariantLine
                        key={row.title}
                        row={row}
                        label={
                          grouped
                            ? options
                                .map((_, i) => valueAt(row, i))
                                .filter((_, i) => i !== groupIndex)
                                .filter(Boolean)
                                .join(" / ") || row.title
                            : row.title
                        }
                        indented={grouped}
                        images={images}
                        symbol={symbol}
                        locationId={locationId}
                        trackInventory={trackInventory}
                        selected={selected.has(row.title)}
                        onSelect={(on) => toggle([row.title], on)}
                        expanded={expanded === row.title}
                        onToggleExpand={() =>
                          setExpanded((prev) => (prev === row.title ? null : row.title))
                        }
                        onOverride={(patch) => onOverride(row.title, patch)}
                        columnCount={columnCount}
                      />
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {trackInventory && (
          <p className="border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Total inventory at {locationName}:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {totalStock}
            </span>{" "}
            available
          </p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function VariantLine({
  row,
  label,
  indented,
  images,
  symbol,
  locationId,
  trackInventory,
  selected,
  onSelect,
  expanded,
  onToggleExpand,
  onOverride,
  columnCount,
}: {
  row: VariantRow;
  label: string;
  indented: boolean;
  images: DraftImage[];
  symbol: string;
  locationId: string;
  trackInventory: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onOverride: (patch: Partial<VariantOverride>) => void;
  columnCount: number;
}) {
  return (
    <>
      <tr
        className={cn(
          "border-b border-border last:border-0 transition-colors duration-100",
          selected && "bg-accent/50",
          !row.available && "opacity-55"
        )}
      >
        <td className={cn("py-2 pr-3", indented ? "pl-9" : "pl-3")}>
          <Checkbox
            aria-label={`Select ${row.title}`}
            checked={selected}
            onCheckedChange={(c) => onSelect(c === true)}
          />
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <VariantImagePicker
              images={images}
              value={row.image_id}
              title={row.title}
              onChange={(image_id) => onOverride({ image_id })}
            />
            <span className="font-medium">{label}</span>
            {!row.available && (
              <span className="text-xs text-muted-foreground">Not for sale</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2">
          <MoneyInput
            aria-label={`Price for ${row.title}`}
            className="w-28"
            symbol={symbol}
            value={row.price}
            onChange={(price) => onOverride({ price })}
          />
        </td>
        <td className="px-3 py-2">
          <Input
            aria-label={`SKU for ${row.title}`}
            className="w-32 font-mono"
            spellCheck={false}
            value={row.sku}
            onChange={(e) => onOverride({ sku: e.target.value })}
          />
        </td>
        {trackInventory && (
          <td className="px-3 py-2">
            <QuantityInput
              aria-label={`Quantity for ${row.title}`}
              className="ml-auto w-20"
              value={row.inventory[locationId] ?? 0}
              onChange={(qty) =>
                onOverride({ inventory: { ...row.inventory, [locationId]: qty } })
              }
            />
          </td>
        )}
        <td className="px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} details for ${row.title}`}
            onClick={onToggleExpand}
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200 motion-reduce:transition-none",
                expanded && "rotate-180"
              )}
            />
          </Button>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-border bg-muted/30">
          <td colSpan={columnCount} className="px-3 py-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Compare-at price</Label>
                <MoneyInput
                  aria-label={`Compare-at price for ${row.title}`}
                  symbol={symbol}
                  value={row.compare_at_price}
                  onChange={(compare_at_price) => onOverride({ compare_at_price })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cost per item</Label>
                <MoneyInput
                  aria-label={`Cost per item for ${row.title}`}
                  symbol={symbol}
                  value={row.cost_per_item}
                  onChange={(cost_per_item) => onOverride({ cost_per_item })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Barcode</Label>
                <Input
                  aria-label={`Barcode for ${row.title}`}
                  className="font-mono"
                  spellCheck={false}
                  value={row.barcode}
                  onChange={(e) => onOverride({ barcode: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Weight</Label>
                <Input
                  aria-label={`Weight for ${row.title}`}
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  value={row.weight}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === "" || /^\d*\.?\d{0,3}$/.test(next)) {
                      onOverride({ weight: next });
                    }
                  }}
                />
              </div>
            </div>

            <label className="mt-3 flex w-fit cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox
                checked={row.available}
                onCheckedChange={(c) => onOverride({ available: c === true })}
              />
              Available for sale
            </label>
          </td>
        </tr>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** Thumbnail that opens a picker over the product's uploaded media. */
function VariantImagePicker({
  images,
  value,
  title,
  onChange,
}: {
  images: DraftImage[];
  value: string | null;
  title: string;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const image = images.find((i) => i.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Choose image for ${title}`}
          disabled={images.length === 0}
          title={
            images.length === 0 ? "Add product media first." : "Choose image"
          }
          className={cn(
            "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted transition-colors duration-150",
            "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            images.length === 0
              ? "cursor-not-allowed border-input opacity-60"
              : "cursor-pointer border-dashed border-input hover:border-ring hover:bg-accent"
          )}
        >
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
            <ImagePlus className="size-3.5 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-64 p-2">
        <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">
          Variant image
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              aria-label={img.alt || `Image ${i + 1}`}
              aria-pressed={img.id === value}
              onClick={() => {
                onChange(img.id);
                setOpen(false);
              }}
              className={cn(
                "aspect-square cursor-pointer overflow-hidden rounded-md border transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                img.id === value
                  ? "border-primary ring-2 ring-primary/40"
                  : "border-input hover:border-ring"
              )}
            >
              <Image
                src={img.url}
                alt=""
                width={56}
                height={56}
                className="size-full object-cover"
                unoptimized
              />
            </button>
          ))}
        </div>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            Remove image
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */

/** Popover for applying one value across the whole selection. */
function BulkValue({
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
