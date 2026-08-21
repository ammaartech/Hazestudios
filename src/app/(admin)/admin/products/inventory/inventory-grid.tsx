"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { DesktopTable } from "@/components/admin/record-list";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Location } from "@/lib/types";
import { adjustInventory } from "../actions";

export interface InventoryRow {
  productId: string;
  variantId: string | null;
  label: string;
  sublabel: string;
  sku: string;
  /** location_id -> quantity */
  quantities: Record<string, number>;
}

export function InventoryGrid({
  rows,
  locations,
}: {
  rows: InventoryRow[];
  /** Only what the grid renders — column headers and per-location cells. */
  locations: Pick<Location, "id" | "name">[];
}) {
  const [data, setData] = useState(rows);
  const [, startTransition] = useTransition();

  function commit(row: InventoryRow, locationId: string, quantity: number) {
    setData((prev) =>
      prev.map((r) =>
        r.productId === row.productId && r.variantId === row.variantId
          ? { ...r, quantities: { ...r.quantities, [locationId]: quantity } }
          : r
      )
    );
    startTransition(async () => {
      const result = await adjustInventory(
        row.productId,
        locationId,
        row.variantId,
        quantity
      );
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <>
      {/*
        The phone shape of a stock count.

        A column per location plus a 96px number field per column made this the
        widest table in the admin — 1,661px at last measure, so on a phone the
        product name was the only thing on screen and every field you came here
        to edit was off the right edge.

        Stacked, each product is a block and its locations are labelled rows
        under it, which is also the only arrangement where a stock field can be
        wide enough to type into with a thumb.
      */}
      <ul className="-mx-2 divide-y md:hidden">
        {data.map((row) => {
          const total = locations.reduce(
            (sum, loc) => sum + (row.quantities[loc.id] ?? 0),
            0
          );
          return (
            <li
              key={`${row.productId}-${row.variantId ?? "simple"}`}
              className="px-2 py-3.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={`/admin/products/${row.productId}`}
                  className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground"
                >
                  {row.label}
                </Link>
                <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                  {total} total
                </span>
              </div>
              {(row.sublabel || row.sku) && (
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {[row.sublabel, row.sku].filter(Boolean).join(" · ")}
                </p>
              )}

              <div className="mt-2 space-y-1.5">
                {locations.map((loc) => (
                  <div key={loc.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                      {loc.name}
                    </span>
                    <Input
                      type="number"
                      min="0"
                      aria-label={`${row.label} quantity at ${loc.name}`}
                      className="h-9 w-24 shrink-0"
                      defaultValue={row.quantities[loc.id] ?? 0}
                      onBlur={(e) => {
                        const q = parseInt(e.target.value) || 0;
                        if (q !== (row.quantities[loc.id] ?? 0))
                          commit(row, loc.id, q);
                      }}
                    />
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      <DesktopTable>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead>SKU</TableHead>
          {locations.map((loc) => (
            <TableHead key={loc.id}>{loc.name}</TableHead>
          ))}
          <TableHead>Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => {
          const total = locations.reduce(
            (sum, loc) => sum + (row.quantities[loc.id] ?? 0),
            0
          );
          return (
            <TableRow key={`${row.productId}-${row.variantId ?? "simple"}`}>
              <TableCell>
                <Link
                  href={`/admin/products/${row.productId}`}
                  className="font-medium transition-colors duration-150 hover:text-primary hover:underline"
                >
                  {row.label}
                </Link>
                {row.sublabel && (
                  <span className="block text-xs text-muted-foreground">
                    {row.sublabel}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.sku || "—"}
              </TableCell>
              {locations.map((loc) => (
                <TableCell key={loc.id}>
                  <Input
                    type="number"
                    min="0"
                    aria-label={`${row.label} quantity at ${loc.name}`}
                    className="h-8 w-24"
                    defaultValue={row.quantities[loc.id] ?? 0}
                    onBlur={(e) => {
                      const q = parseInt(e.target.value) || 0;
                      if (q !== (row.quantities[loc.id] ?? 0)) commit(row, loc.id, q);
                    }}
                  />
                </TableCell>
              ))}
              <TableCell className="font-medium tabular-nums">{total}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
      </DesktopTable>
    </>
  );
}
