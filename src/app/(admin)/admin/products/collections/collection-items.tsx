"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ImageIcon, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProductStatusBadge } from "@/components/admin/status-badges";
import { useFields } from "@/lib/form-store";
import { formatMoney } from "@/lib/format";
import { productMatchesRules } from "@/lib/smart-collections";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/types";
import type { CollectionDraft } from "./collection-draft";
import { useCollectionStore } from "./collection-store";

/** The product fields the picker and the member list need. */
export interface PickerProduct {
  id: string;
  title: string;
  status: Product["status"];
  price: number;
  vendor: string;
  product_type: string;
  tags: string[];
  cover: string | null;
}

const KEYS = ["type", "rules", "product_ids", "sort_order"] as const;

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
      {url ? (
        <Image
          src={url}
          alt={alt}
          width={40}
          height={40}
          className="size-10 object-cover"
          unoptimized
        />
      ) : (
        <ImageIcon className="size-4 text-muted-foreground" />
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Manual membership — an ordered list                                         */
/* -------------------------------------------------------------------------- */

function SortableRow({
  product,
  index,
  reorderable,
  onRemove,
}: {
  product: PickerProduct;
  index: number;
  reorderable: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: product.id, disabled: !reorderable });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-2.5 py-2",
        isDragging ? "z-10 shadow-lg ring-2 ring-primary/50" : "shadow-xs"
      )}
    >
      {/* A dedicated handle rather than the whole row: the row also holds a
          link and a remove button, and a full-row drag surface swallows both. */}
      {reorderable ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${product.title}`}
          className="cursor-grab touch-none rounded p-1 text-muted-foreground outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <span className="w-6 text-center text-xs tabular-nums text-muted-foreground">
          {index + 1}
        </span>
      )}

      <Thumb url={product.cover} alt="" />

      <div className="min-w-0 flex-1">
        <Link
          href={`/admin/products/${product.id}`}
          className="block truncate text-sm font-medium hover:text-primary hover:underline"
        >
          {product.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {product.product_type || product.vendor || "—"}
        </p>
      </div>

      {product.status !== "active" && (
        <ProductStatusBadge status={product.status} />
      )}

      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
        {formatMoney(product.price)}
      </span>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        aria-label={`Remove ${product.title} from this collection`}
      >
        <X className="size-4" />
      </Button>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Product picker                                                              */
/* -------------------------------------------------------------------------- */

function ProductPicker({
  products,
  selected,
  onChange,
}: {
  products: PickerProduct[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  // Staged so Cancel is a real escape hatch — edits apply on Done, not on tap.
  const [staged, setStaged] = useState<string[]>(selected);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (p) =>
        p.title.toLowerCase().includes(needle) ||
        p.vendor.toLowerCase().includes(needle) ||
        p.product_type.toLowerCase().includes(needle)
    );
  }, [products, filter]);

  function toggle(id: string) {
    setStaged((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Re-stage from the live value each time it opens, so a cancelled
        // session does not leak into the next one.
        if (next) setStaged(selected);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus className="size-4" />
          Add products
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add products</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search products"
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="max-h-80 space-y-1 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No products match “{filter}”.
            </p>
          ) : (
            visible.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-1.5 py-1.5 hover:bg-accent"
              >
                <Checkbox
                  checked={staged.includes(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                />
                <Thumb url={p.cover} alt="" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatMoney(p.price)}
                  </span>
                </span>
                {p.status !== "active" && (
                  <ProductStatusBadge status={p.status} />
                )}
              </label>
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              // Preserve the existing arrangement and append what's new, rather
              // than adopting the picker's order and shuffling the collection.
              const kept = selected.filter((id) => staged.includes(id));
              const added = staged.filter((id) => !selected.includes(id));
              onChange([...kept, ...added]);
              setOpen(false);
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

export function CollectionItems({ products }: { products: PickerProduct[] }) {
  const store = useCollectionStore();
  const v = useFields<CollectionDraft, (typeof KEYS)[number]>(store, KEYS);

  const byId = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Smart membership is computed, never stored — the same rule evaluation the
  // storefront runs, so what is previewed here is what will actually be shown.
  const smartMatches = useMemo(() => {
    if (v.type !== "smart") return [];
    const rules = v.rules.filter((r) => r.value.trim());
    if (!rules.length) return [];
    return products.filter((p) => productMatchesRules(p, rules));
  }, [v.type, v.rules, products]);

  const members =
    v.type === "manual"
      ? v.product_ids
          .map((id) => byId.get(id))
          .filter((p): p is PickerProduct => Boolean(p))
      : smartMatches;

  // Manual order is only meaningful when the storefront is actually reading it.
  const reorderable = v.type === "manual" && v.sort_order === "manual";

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    store.update("product_ids", (prev) => {
      const from = prev.indexOf(String(active.id));
      const to = prev.indexOf(String(over.id));
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  }

  return (
    <Card id="section-items" className="scroll-mt-32">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          Collection items
          <Badge variant="secondary" className="tabular-nums">
            {members.length}
          </Badge>
        </CardTitle>

        {v.type === "manual" ? (
          <ProductPicker
            products={products}
            selected={v.product_ids}
            onChange={(ids) => store.set("product_ids", ids)}
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            Managed by conditions
          </span>
        )}
      </CardHeader>

      <CardContent>
        {members.length === 0 ? (
          <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            {v.type === "manual"
              ? "No products yet — add some to populate this collection."
              : v.rules.some((r) => r.value.trim())
                ? "No products match these conditions yet."
                : "Add a condition to populate this collection."}
          </p>
        ) : v.type === "manual" ? (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={members.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-1.5">
                  {members.map((p, i) => (
                    <SortableRow
                      key={p.id}
                      product={p}
                      index={i}
                      reorderable={reorderable}
                      onRemove={() =>
                        store.update("product_ids", (prev) =>
                          prev.filter((id) => id !== p.id)
                        )
                      }
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>

            {!reorderable && (
              <p className="mt-3 text-xs text-muted-foreground">
                Sort order is set to an automatic rule, so this arrangement is
                not used. Switch sorting to “Manually” to reorder.
              </p>
            )}
          </>
        ) : (
          <ul className="space-y-1.5">
            {members.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-lg border bg-card px-2.5 py-2 shadow-xs"
              >
                <Thumb url={p.cover} alt="" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/products/${p.id}`}
                    className="block truncate text-sm font-medium hover:text-primary hover:underline"
                  >
                    {p.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.product_type || p.vendor || "—"}
                  </p>
                </div>
                {p.status !== "active" && (
                  <ProductStatusBadge status={p.status} />
                )}
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {formatMoney(p.price)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
