"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagsInput } from "@/components/admin/tags-input";
import { useField } from "@/lib/form-store";
import type { Collection } from "@/lib/types";
import type { ProductFacets } from "../actions";
import { useProductStore } from "../product-draft";
import { Field } from "./fields";

/** Native datalist: instant, keyboard-native, and no popover to clip. */
function SuggestInput({
  value,
  onChange,
  options,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
} & Omit<React.ComponentProps<"input">, "value" | "onChange" | "list">) {
  const listId = useId();
  return (
    <>
      <Input
        {...props}
        list={options.length ? listId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  );
}

export function OrganizationSection({
  collections,
  facets,
}: {
  collections: Collection[];
  facets: ProductFacets;
}) {
  const store = useProductStore();
  const [category, setCategory] = useField(store, "category");
  const [productType, setProductType] = useField(store, "product_type");
  const [vendor, setVendor] = useField(store, "vendor");
  const [collectionIds, setCollectionIds] = useField(store, "collection_ids");
  const [tags, setTags] = useField(store, "tags");
  const [query, setQuery] = useState("");

  // Smart collections claim products by rule, so offering a checkbox for one
  // would be a control that silently does nothing.
  const manual = useMemo(
    () => collections.filter((c) => c.type === "manual"),
    [collections]
  );
  const smartCount = collections.length - manual.length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return manual;
    return manual.filter((c) => c.title.toLowerCase().includes(q));
  }, [manual, query]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organization</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          label="Category"
          optional
          hint="Helps set the right tax rate and shipping profile."
        >
          {(props) => (
            <SuggestInput
              {...props}
              value={category}
              onChange={setCategory}
              options={facets.categories}
              placeholder="e.g. Apparel & Accessories"
            />
          )}
        </Field>

        <Field label="Product type" optional>
          {(props) => (
            <SuggestInput
              {...props}
              value={productType}
              onChange={setProductType}
              options={facets.types}
              placeholder="e.g. T-shirt"
            />
          )}
        </Field>

        <Field label="Vendor" optional>
          {(props) => (
            <SuggestInput
              {...props}
              value={vendor}
              onChange={setVendor}
              options={facets.vendors}
              placeholder="e.g. Hazestudios"
            />
          )}
        </Field>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label>Collections</Label>
            {collectionIds.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {collectionIds.length} selected
              </span>
            )}
          </div>

          {manual.length === 0 ? (
            <div className="rounded-lg border border-dashed border-input p-3 text-center">
              <p className="text-xs text-muted-foreground">
                No manual collections yet.
              </p>
              <Link
                href="/admin/products/collections/new"
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors duration-150 hover:underline"
              >
                <Plus className="size-3" />
                Create one
              </Link>
            </div>
          ) : (
            <>
              {manual.length > 6 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter collections"
                    aria-label="Filter collections"
                    className="h-7 pl-7 text-xs"
                  />
                </div>
              )}
              <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-input p-1">
                {visible.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No collections match “{query}”.
                  </p>
                ) : (
                  visible.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-100 hover:bg-accent"
                    >
                      <Checkbox
                        checked={collectionIds.includes(c.id)}
                        onCheckedChange={(checked) =>
                          setCollectionIds(
                            checked === true
                              ? [...collectionIds, c.id]
                              : collectionIds.filter((id) => id !== c.id)
                          )
                        }
                      />
                      <span className="truncate">{c.title}</span>
                    </label>
                  ))
                )}
              </div>
            </>
          )}

          {smartCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {smartCount} smart collection{smartCount === 1 ? "" : "s"} add
              products automatically from their rules.
            </p>
          )}
        </div>

        <Field
          label="Tags"
          optional
          hint="Used for search, filtering, and smart collection rules."
        >
          {(props) => (
            <TagsInput
              id={props.id}
              value={tags}
              onChange={setTags}
              suggestions={facets.tags}
            />
          )}
        </Field>
      </CardContent>
    </Card>
  );
}
