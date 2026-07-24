"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteCollectionBulk, setCollectionPublishedBulk } from "./actions";

/** A collection flattened for the list — the server does the counting. */
export interface CollectionListRow {
  id: string;
  title: string;
  handle: string;
  type: "manual" | "smart";
  image_url: string | null;
  productCount: number;
  conditions: string;
  published: boolean;
  updated_at: string;
}

const PAGE_SIZE = 50;

type ColumnKey = "type" | "products" | "conditions" | "visibility" | "updated";

const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "type", label: "Type" },
  { key: "products", label: "Products" },
  { key: "conditions", label: "Conditions" },
  { key: "visibility", label: "Visibility" },
  { key: "updated", label: "Last updated" },
];

const VIEWS: { label: string; value: string | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Published", value: "published" },
  { label: "Unpublished", value: "unpublished" },
];

export function CollectionsTable({
  collections,
  view,
}: {
  collections: CollectionListRow[];
  view?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  // `updated` is available but off by default, matching the reference layout.
  const [visible, setVisible] = useState<Set<ColumnKey>>(
    new Set(["type", "products", "conditions", "visibility"])
  );

  const pageCount = Math.max(1, Math.ceil(collections.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const paged = useMemo(
    () => collections.slice(start, start + PAGE_SIZE),
    [collections, start]
  );

  const allSelected =
    collections.length > 0 && selected.size === collections.length;
  const headerState: boolean | "indeterminate" = allSelected
    ? true
    : selected.size > 0
      ? "indeterminate"
      : false;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(collections.map((c) => c.id)));
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulk(
    fn: () => Promise<{ ok?: boolean; error?: string }>,
    done: string
  ) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(done);
      setSelected(new Set());
      router.refresh();
    });
  }

  const ids = () => [...selected];
  const currentView =
    VIEWS.find((v) => v.value === (view || undefined)) ?? VIEWS[0];

  return (
    <div>
      {/* Control row — becomes a selection toolbar once rows are picked. */}
      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={headerState}
              onCheckedChange={toggleAll}
              aria-label="Select all collections"
            />
            {selected.size} selected
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                runBulk(
                  () => setCollectionPublishedBulk(ids(), true),
                  "Collections published"
                )
              }
            >
              Publish
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                runBulk(
                  () => setCollectionPublishedBulk(ids(), false),
                  "Collections unpublished"
                )
              }
            >
              Unpublish
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => {
                const n = selected.size;
                if (
                  !window.confirm(
                    `Delete ${n} collection${n === 1 ? "" : "s"}? The products stay, but the grouping is gone for good.`
                  )
                )
                  return;
                runBulk(() => deleteCollectionBulk(ids()), "Collections deleted");
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
                    router.push(
                      v.value
                        ? `/admin/products/collections?view=${v.value}`
                        : "/admin/products/collections"
                    )
                  }
                >
                  {v.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <SearchInput
            placeholder="Search and filter"
            className="max-w-none flex-1"
          />

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

      {collections.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No collections found.{" "}
            <Link
              href="/admin/products/collections/new"
              className="text-primary hover:underline"
            >
              Create your first collection
            </Link>
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
            Collections group products for the storefront — the drop, outerwear,
            the archive. They appear in the navigation and each gets its own page.
          </p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-1">
                  <Checkbox
                    checked={headerState}
                    onCheckedChange={toggleAll}
                    aria-label="Select all collections"
                  />
                </TableHead>
                <TableHead>Title</TableHead>
                {visible.has("type") && <TableHead>Type</TableHead>}
                {visible.has("products") && <TableHead>Products</TableHead>}
                {visible.has("conditions") && <TableHead>Conditions</TableHead>}
                {visible.has("visibility") && <TableHead>Visibility</TableHead>}
                {visible.has("updated") && <TableHead>Last updated</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((c) => {
                const isSelected = selected.has(c.id);
                return (
                  <TableRow
                    key={c.id}
                    data-state={isSelected ? "selected" : undefined}
                  >
                    <TableCell className="pl-1">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleRow(c.id)}
                        aria-label={`Select ${c.title}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                          {c.image_url ? (
                            <Image
                              src={c.image_url}
                              alt=""
                              width={40}
                              height={40}
                              className="size-10 object-cover"
                              unoptimized
                            />
                          ) : (
                            <ImageIcon className="size-4 text-muted-foreground" />
                          )}
                        </span>
                        <Link
                          href={`/admin/products/collections/${c.id}`}
                          className="font-medium text-foreground transition-colors duration-150 hover:text-primary hover:underline"
                        >
                          {c.title}
                        </Link>
                      </div>
                    </TableCell>
                    {visible.has("type") && (
                      <TableCell>
                        <Badge
                          variant={c.type === "smart" ? "default" : "secondary"}
                        >
                          {c.type === "smart" ? "Smart" : "Manual"}
                        </Badge>
                      </TableCell>
                    )}
                    {visible.has("products") && (
                      <TableCell className="tabular-nums">
                        {c.productCount}
                      </TableCell>
                    )}
                    {visible.has("conditions") && (
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {c.conditions || "—"}
                      </TableCell>
                    )}
                    {visible.has("visibility") && (
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-sm",
                            c.published
                              ? "text-muted-foreground"
                              : "text-foreground"
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              c.published ? "bg-emerald-500" : "bg-muted-foreground/40"
                            )}
                            aria-hidden
                          />
                          {c.published ? "Published" : "Hidden"}
                        </span>
                      </TableCell>
                    )}
                    {visible.has("updated") && (
                      <TableCell className="text-muted-foreground">
                        {formatDate(c.updated_at)}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-center gap-2 border-t pt-3">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {start + 1}–{Math.min(collections.length, start + PAGE_SIZE)}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
