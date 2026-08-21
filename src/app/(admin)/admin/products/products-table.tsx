"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Columns3, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchInput } from "@/components/admin/search-input";
import { ProductStatusBadge } from "@/components/admin/status-badges";
import { DesktopTable, RecordList } from "@/components/admin/record-list";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductStatus } from "@/lib/types";
import { setProductStatusBulk, deleteProductBulk } from "./actions";

/** A product flattened for the list — the server does the joins and the math. */
export interface ProductListRow {
  id: string;
  title: string;
  status: ProductStatus;
  category: string;
  product_type: string;
  vendor: string;
  price: number;
  track_inventory: boolean;
  cover: string | null;
  stock: number;
}

/** Below this, the inventory count turns red — the same cue Shopify uses. */
const LOW_STOCK = 10;
/** Sales channels every product publishes to here (Online Store + POS). */
const CHANNELS = 2;

type ColumnKey =
  | "status"
  | "inventory"
  | "category"
  | "channels"
  | "type"
  | "vendor"
  | "price";

const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "inventory", label: "Inventory" },
  { key: "category", label: "Category" },
  { key: "channels", label: "Channels" },
  { key: "type", label: "Product type" },
  { key: "vendor", label: "Vendor" },
  { key: "price", label: "Price" },
];

const VIEWS: { label: string; value: ProductStatus | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Active", value: "active" },
  { label: "Draft", value: "draft" },
  { label: "Archived", value: "archived" },
];

export function ProductsTable({
  products,
  status,
}: {
  products: ProductListRow[];
  status?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Price is available but hidden by default, matching the reference layout.
  const [visible, setVisible] = useState<Set<ColumnKey>>(
    new Set(["status", "inventory", "category", "channels", "type", "vendor"])
  );

  const allSelected = products.length > 0 && selected.size === products.length;
  const headerState: boolean | "indeterminate" = allSelected
    ? true
    : selected.size > 0
      ? "indeterminate"
      : false;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulk(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(done);
      setSelected(new Set());
      router.refresh();
    });
  }

  const ids = () => [...selected];
  const currentView = VIEWS.find((v) => v.value === (status || undefined)) ?? VIEWS[0];

  return (
    <div>
      {/* Control row — becomes a selection toolbar once rows are picked. */}
      {selected.size > 0 ? (
        <div className="glass-floating mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={headerState}
              onCheckedChange={toggleAll}
              aria-label="Select all products"
            />
            {selected.size} selected
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                runBulk(() => setProductStatusBulk(ids(), "active"), "Products set to active")
              }
            >
              Set as active
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                runBulk(() => setProductStatusBulk(ids(), "draft"), "Products set to draft")
              }
            >
              Set as draft
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                runBulk(() => setProductStatusBulk(ids(), "archived"), "Products archived")
              }
            >
              Archive
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => {
                const n = selected.size;
                if (!window.confirm(`Delete ${n} product${n === 1 ? "" : "s"}? This can't be undone.`))
                  return;
                runBulk(() => deleteProductBulk(ids()), "Products deleted");
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                {currentView.label}
                <ChevronsUpDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              {VIEWS.map((v) => (
                <DropdownMenuItem
                  key={v.label}
                  onSelect={() =>
                    router.push(v.value ? `/admin/products?status=${v.value}` : "/admin/products")
                  }
                >
                  {v.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <SearchInput placeholder="Search and filter" className="max-w-none flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="Edit columns">
                <Columns3 className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMNS.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visible.has(col.key)}
                  onCheckedChange={(on) =>
                    setVisible((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(col.key);
                      else next.delete(col.key);
                      return next;
                    })
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {products.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No products found.{" "}
          <Link href="/admin/products/new" className="text-primary hover:underline">
            Add your first product
          </Link>
        </p>
      ) : (
        <>
          {/* Phones: a tappable card per product, with the thumbnail that makes
              a catalogue scannable. The column chooser above only governs the
              desktop table — on a 390px screen there is no room to choose. */}
          <RecordList
            items={products.map((p) => ({
              id: p.id,
              href: `/admin/products/${p.id}`,
              title: p.title,
              subtitle: p.vendor || p.product_type || null,
              amount: formatMoney(p.price),
              badges: <ProductStatusBadge status={p.status} />,
              media: (
                <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                  {p.cover ? (
                    <Image
                      src={p.cover}
                      alt=""
                      width={44}
                      height={44}
                      sizes="44px"
                      quality={60}
                      className="size-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
                  )}
                </span>
              ),
            }))}
          />

          <DesktopTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-1">
                <Checkbox
                  checked={headerState}
                  onCheckedChange={toggleAll}
                  aria-label="Select all products"
                />
              </TableHead>
              <TableHead>Product</TableHead>
              {visible.has("status") && <TableHead>Status</TableHead>}
              {visible.has("inventory") && <TableHead>Inventory</TableHead>}
              {visible.has("category") && <TableHead>Category</TableHead>}
              {visible.has("channels") && <TableHead>Channels</TableHead>}
              {visible.has("type") && <TableHead>Product type</TableHead>}
              {visible.has("vendor") && <TableHead>Vendor</TableHead>}
              {visible.has("price") && <TableHead className="text-right">Price</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => {
              const isSelected = selected.has(p.id);
              return (
                <TableRow key={p.id} data-state={isSelected ? "selected" : undefined}>
                  <TableCell className="pl-1">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleRow(p.id)}
                      aria-label={`Select ${p.title}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                        {p.cover ? (
                          <Image
                            src={p.cover}
                            alt={p.title}
                            width={40}
                            height={40}
                            className="size-10 object-cover"
                            quality={60}
                          />
                        ) : (
                          <ImageIcon className="size-4 text-muted-foreground" />
                        )}
                      </span>
                      {/* Opens the editor — the storefront link used to drop
                          the operator out of the admin mid-task. */}
                      <Link
                        href={`/admin/products/${p.id}`}
                        className="font-medium text-foreground transition-colors duration-150 hover:text-primary hover:underline"
                      >
                        {p.title}
                      </Link>
                    </div>
                  </TableCell>
                  {visible.has("status") && (
                    <TableCell>
                      <ProductStatusBadge status={p.status} />
                    </TableCell>
                  )}
                  {visible.has("inventory") && (
                    <TableCell className="tabular-nums">
                      {p.track_inventory ? (
                        <span className={cn(p.stock < LOW_STOCK && "text-destructive")}>
                          {p.stock} in stock
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Inventory not tracked</span>
                      )}
                    </TableCell>
                  )}
                  {/* Blank rather than an em-dash for missing values. Most rows
                      have no category or type, and a column of dashes draws the
                      eye to the absence; the reference leaves them empty. */}
                  {visible.has("category") && (
                    <TableCell>{p.category}</TableCell>
                  )}
                  {visible.has("channels") && (
                    <TableCell className="tabular-nums text-muted-foreground">
                      {CHANNELS}
                    </TableCell>
                  )}
                  {visible.has("type") && (
                    <TableCell className="text-muted-foreground">
                      {p.product_type}
                    </TableCell>
                  )}
                  {visible.has("vendor") && (
                    <TableCell className="text-muted-foreground">
                      {p.vendor}
                    </TableCell>
                  )}
                  {visible.has("price") && (
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(p.price)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
          </DesktopTable>
        </>
      )}
    </div>
  );
}
