"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
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
  locations: Location[];
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
                  href={`/products/${row.productId}`}
                  className="font-medium hover:underline"
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
  );
}
