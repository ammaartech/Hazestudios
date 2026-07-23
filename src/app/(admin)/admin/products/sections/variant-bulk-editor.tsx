"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ArrowLeft, Columns3, ImageIcon } from "lucide-react";
import type { DraftImage } from "@/components/admin/media-uploader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Location } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { VariantOverride, VariantRow } from "../product-draft";

type CellKind = "money" | "text" | "qty" | "bool";

interface Column {
  id: string;
  label: string;
  kind: CellKind;
  /** shown under the header, for columns whose name alone is ambiguous */
  hint?: string;
  get: (row: VariantRow) => string | boolean;
  set: (row: VariantRow, value: string | boolean) => Partial<VariantOverride>;
}

export interface BulkEditorProps {
  rows: VariantRow[];
  images: DraftImage[];
  locations: Location[];
  symbol: string;
  trackInventory: boolean;
  requiresShipping: boolean;
  productTitle: string;
  onOverride: (title: string, patch: Partial<VariantOverride>) => void;
  onClose: () => void;
}

/**
 * Spreadsheet editor for many variants at once.
 *
 * It writes straight through to the product draft rather than staging its own
 * copy. A second Save inside a page that already has an unsaved-changes bar
 * reads as two competing commits; here "Done" only closes the overlay, and the
 * edits ride out on the product's own save.
 */
export function VariantBulkEditor({
  rows,
  images,
  locations,
  symbol,
  trackInventory,
  requiresShipping,
  productTitle,
  onOverride,
  onClose,
}: BulkEditorProps) {
  const cells = useRef(new Map<string, HTMLElement>());

  const columns = useMemo<Column[]>(() => {
    const base: Column[] = [
      {
        id: "price",
        label: "Price",
        hint: symbol,
        kind: "money",
        get: (r) => r.price,
        set: (_, v) => ({ price: String(v) }),
      },
      {
        id: "compare_at_price",
        label: "Compare-at price",
        hint: symbol,
        kind: "money",
        get: (r) => r.compare_at_price,
        set: (_, v) => ({ compare_at_price: String(v) }),
      },
      {
        id: "cost_per_item",
        label: "Cost per item",
        hint: symbol,
        kind: "money",
        get: (r) => r.cost_per_item,
        set: (_, v) => ({ cost_per_item: String(v) }),
      },
      {
        id: "sku",
        label: "SKU",
        kind: "text",
        get: (r) => r.sku,
        set: (_, v) => ({ sku: String(v) }),
      },
      {
        id: "barcode",
        label: "Barcode",
        kind: "text",
        get: (r) => r.barcode,
        set: (_, v) => ({ barcode: String(v) }),
      },
    ];

    if (requiresShipping) {
      base.push({
        id: "weight",
        label: "Weight",
        kind: "money",
        get: (r) => r.weight,
        set: (_, v) => ({ weight: String(v) }),
      });
    }

    if (trackInventory) {
      for (const location of locations) {
        base.push({
          id: `stock:${location.id}`,
          label: location.name,
          hint: "Available",
          kind: "qty",
          get: (r) => String(r.inventory[location.id] ?? 0),
          set: (r, v) => ({
            inventory: { ...r.inventory, [location.id]: Number(v) || 0 },
          }),
        });
      }
    }

    base.push({
      id: "available",
      label: "For sale",
      kind: "bool",
      get: (r) => r.available,
      set: (_, v) => ({ available: v === true }),
    });

    return base;
  }, [symbol, requiresShipping, trackInventory, locations]);

  // Everything but the long-tail columns, so the default view fits without
  // horizontal scrolling on a laptop.
  const [visible, setVisible] = useState<Set<string>>(
    () =>
      new Set(
        columns
          .filter(
            (c) =>
              !["compare_at_price", "cost_per_item", "barcode", "weight"].includes(
                c.id
              )
          )
          .map((c) => c.id)
      )
  );

  const shown = columns.filter((c) => visible.has(c.id));

  // The overlay owns the viewport; letting the page behind it scroll is the
  // classic modal bug where dismissing returns you somewhere else.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const focusCell = useCallback((row: number, col: number) => {
    const el = cells.current.get(`${row}:${col}`);
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  }, []);

  /** Copy the focused cell down the rest of its column. */
  const fillDown = useCallback(
    (row: number, col: number) => {
      const column = shown[col];
      const source = rows[row];
      if (!column || !source) return;
      const value = column.get(source);
      for (let r = row + 1; r < rows.length; r += 1) {
        onOverride(rows[r].title, column.set(rows[r], value));
      }
    },
    [shown, rows, onOverride]
  );

  function handleKeyDown(
    e: React.KeyboardEvent,
    row: number,
    col: number
  ) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      fillDown(row, col);
      return;
    }
    // Left/right are left alone — they belong to the caret inside the field.
    switch (e.key) {
      case "ArrowDown":
      case "Enter":
        e.preventDefault();
        focusCell(row + 1, col);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusCell(row - 1, col);
        break;
    }
  }

  function registerCell(row: number, col: number) {
    return (el: HTMLElement | null) => {
      const key = `${row}:${col}`;
      if (el) cells.current.set(key, el);
      else cells.current.delete(key);
    };
  }

  // Rendered only in response to a click, so this never runs during SSR — the
  // guard is here so a future server render degrades to nothing, not a crash.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Editing ${rows.length} variants`}
      className="fixed inset-0 z-50 flex flex-col bg-background motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <h2 className="text-sm font-semibold">
          Editing {rows.length} {rows.length === 1 ? "variant" : "variants"}
        </h2>

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Columns3 className="size-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={visible.has(column.id)}
                  // Keep the menu open: choosing columns is a multi-step task.
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(on) =>
                    setVisible((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(column.id);
                      else next.delete(column.id);
                      // Never let the grid become column-less.
                      return next.size ? next : prev;
                    })
                  }
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button type="button" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 min-w-64 border-b border-r border-border bg-muted px-3 py-2 text-left font-medium"
              >
                Title
              </th>
              {shown.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className="sticky top-0 z-20 min-w-36 border-b border-border bg-muted px-3 py-2 text-left font-medium"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    {column.label}
                    {column.hint && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {column.hint}
                      </span>
                    )}
                  </span>
                </th>
              ))}
              {/* Absorbs leftover width so the last real column keeps its size. */}
              <th className="sticky top-0 z-20 w-full border-b border-border bg-muted">
                <span className="sr-only">Spacer</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, r) => {
              const image = images.find((i) => i.id === row.image_id);
              return (
                <tr key={row.title} className="group/row">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-1.5 text-left font-normal group-hover/row:bg-accent/40"
                  >
                    <span className="flex items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-input bg-muted">
                        {image ? (
                          <Image
                            src={image.url}
                            alt=""
                            width={24}
                            height={24}
                            className="size-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <ImageIcon className="size-3 text-muted-foreground" />
                        )}
                      </span>
                      <span className="truncate text-muted-foreground">
                        {productTitle || "Untitled"} –{" "}
                        <span className="text-foreground">{row.title}</span>
                      </span>
                    </span>
                  </th>

                  {shown.map((column, c) => (
                    <td
                      key={column.id}
                      className="border-b border-border px-1 py-1 group-hover/row:bg-accent/20"
                    >
                      <Cell
                        column={column}
                        row={row}
                        symbol={symbol}
                        ref={registerCell(r, c)}
                        onKeyDown={(e) => handleKeyDown(e, r, c)}
                        onChange={(value) =>
                          onOverride(row.title, column.set(row, value))
                        }
                      />
                    </td>
                  ))}
                  <td className="border-b border-border" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="shrink-0 border-t border-border bg-card px-4 py-2 text-xs text-muted-foreground">
        <kbd className="rounded border border-input px-1 font-mono">↑</kbd>{" "}
        <kbd className="rounded border border-input px-1 font-mono">↓</kbd> move
        between rows ·{" "}
        <kbd className="rounded border border-input px-1 font-mono">Ctrl</kbd>+
        <kbd className="rounded border border-input px-1 font-mono">D</kbd> fills
        the value down the column · changes save with the product
      </footer>
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One grid cell. Borderless until focused — a full input chrome repeated across
 * a hundred cells is visual noise, and the grid lines already say "editable".
 */
function Cell({
  column,
  row,
  symbol,
  ref,
  onChange,
  onKeyDown,
}: {
  column: Column;
  row: VariantRow;
  symbol: string;
  ref: (el: HTMLElement | null) => void;
  onChange: (value: string | boolean) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const value = column.get(row);
  const label = `${column.label} for ${row.title}`;

  if (column.kind === "bool") {
    return (
      <span className="flex items-center justify-center py-1">
        <Checkbox
          ref={ref as (el: HTMLButtonElement | null) => void}
          aria-label={label}
          checked={value === true}
          onKeyDown={onKeyDown}
          onCheckedChange={(c) => onChange(c === true)}
        />
      </span>
    );
  }

  const numeric = column.kind === "money" || column.kind === "qty";

  return (
    <Input
      ref={ref as (el: HTMLInputElement | null) => void}
      aria-label={label}
      spellCheck={false}
      inputMode={
        column.kind === "money" ? "decimal" : column.kind === "qty" ? "numeric" : undefined
      }
      placeholder={column.kind === "money" ? `${symbol} 0.00` : undefined}
      value={String(value)}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const next = e.target.value;
        if (column.kind === "money") {
          if (next === "" || /^\d*\.?\d{0,2}$/.test(next)) onChange(next);
          return;
        }
        if (column.kind === "qty") {
          onChange(next.replace(/[^\d]/g, "") || "0");
          return;
        }
        onChange(next);
      }}
      className={cn(
        "h-8 rounded-md border-transparent bg-transparent shadow-none",
        "hover:border-input focus-visible:border-ring",
        numeric && "text-right tabular-nums",
        column.kind === "text" && "font-mono"
      )}
    />
  );
}
