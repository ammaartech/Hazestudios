"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImageIcon, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { createClient } from "@/lib/supabase/client";
import { useField, useFields } from "@/lib/form-store";
import { handleize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CollectionRule, CollectionSort, CollectionType } from "@/lib/types";
import type { CollectionDraft, RuleDraft } from "./collection-draft";
import { useCollectionStore } from "./collection-store";

const RULE_FIELDS: { value: CollectionRule["field"]; label: string }[] = [
  { value: "tag", label: "Tag" },
  { value: "title", label: "Title" },
  { value: "vendor", label: "Vendor" },
  { value: "product_type", label: "Product type" },
  { value: "price", label: "Price" },
];

const TEXT_OPERATORS: { value: CollectionRule["operator"]; label: string }[] = [
  { value: "equals", label: "is equal to" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
];

const PRICE_OPERATORS: { value: CollectionRule["operator"]; label: string }[] = [
  { value: "equals", label: "is equal to" },
  { value: "greater_than", label: "is greater than" },
  { value: "less_than", label: "is less than" },
];

const SORTS: { value: CollectionSort; label: string }[] = [
  { value: "manual", label: "Manually" },
  { value: "alpha_asc", label: "Alphabetically, A–Z" },
  { value: "alpha_desc", label: "Alphabetically, Z–A" },
  { value: "price_asc", label: "Price, low to high" },
  { value: "price_desc", label: "Price, high to low" },
  { value: "created_desc", label: "Date, new to old" },
  { value: "created_asc", label: "Date, old to new" },
];

/* -------------------------------------------------------------------------- */
/* Title, description                                                          */
/* -------------------------------------------------------------------------- */

export function DetailsSection() {
  const store = useCollectionStore();
  const [title, setTitle] = useField(store, "title");
  const [description, setDescription] = useField(store, "description");

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="collection-title">Title</Label>
          <Input
            id="collection-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. SS26 — Drop 01"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="collection-description">Description</Label>
          <Textarea
            id="collection-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="resize-y"
            placeholder="Shown under the collection title on the storefront."
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Artwork                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The collection's image.
 *
 * Worth knowing how far this reaches: it is the full-bleed hero on
 * /collections/[handle], the artwork on the home page's editorial tiles, and —
 * for whichever collection sorts first — the campaign hero on the home page
 * itself. It is the largest image on the storefront, and until now there was no
 * field for it anywhere in the admin.
 */
export function ImageSection() {
  const store = useCollectionStore();
  const [imageUrl, setImageUrl] = useField(store, "image_url");
  const [title] = useField(store, "title");
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("That file is not an image.");
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `collection-${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from("product-images")
      .upload(path, file, { cacheControl: "3600", upsert: true });

    setUploading(false);
    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      return;
    }
    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    setImageUrl(data.publicUrl);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Image</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className={cn(
            "relative flex aspect-3/2 w-full items-center justify-center overflow-hidden rounded-lg border bg-muted",
            !imageUrl && "border-dashed"
          )}
        >
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={title || "Collection artwork"}
              fill
              sizes="320px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <span className="flex flex-col items-center gap-1.5 text-muted-foreground">
              <ImageIcon className="size-6" />
              <span className="text-xs">No image</span>
            </span>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {uploading ? "Uploading…" : imageUrl ? "Replace" : "Upload"}
          </Button>
          {imageUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setImageUrl(null)}
            >
              Remove
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Used as the hero on the collection page and on the home page tiles.
          Wide crops work best.
        </p>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Visibility                                                                  */
/* -------------------------------------------------------------------------- */

export function VisibilitySection() {
  const store = useCollectionStore();
  const [published, setPublished] = useField(store, "published");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Visibility</CardTitle>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={published ? "published" : "hidden"}
          onValueChange={(v) => setPublished(v === "published")}
          className="space-y-1"
        >
          <label className="flex cursor-pointer items-start gap-2">
            <RadioGroupItem value="published" className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Published</span>
              <span className="block text-xs text-muted-foreground">
                Live on the storefront and in the navigation.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <RadioGroupItem value="hidden" className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Hidden</span>
              <span className="block text-xs text-muted-foreground">
                Staged for a drop. The page returns 404 until published.
              </span>
            </span>
          </label>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Type + conditions + sort                                                    */
/* -------------------------------------------------------------------------- */

const TYPE_KEYS = ["type", "rules", "sort_order"] as const;

export function TypeSection() {
  const store = useCollectionStore();
  const v = useFields<CollectionDraft, (typeof TYPE_KEYS)[number]>(
    store,
    TYPE_KEYS
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Products</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={v.type}
          onValueChange={(next) => store.set("type", next as CollectionType)}
          className="space-y-1"
        >
          <label className="flex cursor-pointer items-start gap-2">
            <RadioGroupItem value="manual" className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Manual</span>
              <span className="block text-xs text-muted-foreground">
                Pick products one by one and arrange them yourself.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <RadioGroupItem value="smart" className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Smart</span>
              <span className="block text-xs text-muted-foreground">
                Products matching the conditions are included automatically.
              </span>
            </span>
          </label>
        </RadioGroup>

        {v.type === "smart" && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Must match all conditions</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  store.update("rules", (prev) => [
                    ...prev,
                    {
                      key: crypto.randomUUID(),
                      field: "tag",
                      operator: "equals",
                      value: "",
                    } satisfies RuleDraft,
                  ])
                }
              >
                <Plus className="size-4" />
                Add condition
              </Button>
            </div>

            {v.rules.length === 0 && (
              <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                No conditions yet — this collection is empty until one is added.
              </p>
            )}

            {v.rules.map((rule) => {
              const operators =
                rule.field === "price" ? PRICE_OPERATORS : TEXT_OPERATORS;
              return (
                <div key={rule.key} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={rule.field}
                    onValueChange={(field) =>
                      store.update("rules", (prev) =>
                        prev.map((r) =>
                          r.key === rule.key
                            ? {
                                ...r,
                                field: field as CollectionRule["field"],
                                // Operators differ between text and price, so a
                                // field change must reset it or the rule can end
                                // up with one its field cannot use.
                                operator: "equals",
                              }
                            : r
                        )
                      )
                    }
                  >
                    <SelectTrigger className="w-32" aria-label="Condition field">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RULE_FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={rule.operator}
                    onValueChange={(operator) =>
                      store.update("rules", (prev) =>
                        prev.map((r) =>
                          r.key === rule.key
                            ? {
                                ...r,
                                operator: operator as CollectionRule["operator"],
                              }
                            : r
                        )
                      )
                    }
                  >
                    <SelectTrigger
                      className="w-36"
                      aria-label="Condition operator"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {operators.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    value={rule.value}
                    aria-label="Condition value"
                    placeholder={rule.field === "price" ? "0.00" : "Value"}
                    className="w-32 flex-1"
                    onChange={(e) =>
                      store.update("rules", (prev) =>
                        prev.map((r) =>
                          r.key === rule.key ? { ...r, value: e.target.value } : r
                        )
                      )
                    }
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove condition"
                    onClick={() =>
                      store.update("rules", (prev) =>
                        prev.filter((r) => r.key !== rule.key)
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="collection-sort">Sort products by</Label>
          <Select
            value={v.sort_order}
            onValueChange={(next) =>
              store.set("sort_order", next as CollectionSort)
            }
          >
            <SelectTrigger id="collection-sort" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {v.sort_order === "manual"
              ? "Uses the order you arrange in Collection items."
              : "Applied on the storefront every time the page is rendered."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* SEO                                                                         */
/* -------------------------------------------------------------------------- */

const SEO_KEYS = [
  "title",
  "handle",
  "seo_title",
  "seo_description",
  "description",
] as const;

const TITLE_MAX = 70;
const DESC_MAX = 320;

function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={cn("text-xs tabular-nums", over && "text-destructive")}>
      {value.length}/{max}
    </span>
  );
}

export function SeoSection({ storeUrl = "hazestudios.com" }: { storeUrl?: string }) {
  const store = useCollectionStore();
  const v = useFields<CollectionDraft, (typeof SEO_KEYS)[number]>(store, SEO_KEYS);
  const [editingHandle, setEditingHandle] = useState(false);

  // Empty SEO fields inherit exactly as they will at render time, so the
  // preview shows what a search engine will actually see rather than blanks.
  const effectiveHandle =
    v.handle.trim() || handleize(v.title) || "collection-handle";
  const effectiveTitle = v.seo_title.trim() || v.title.trim() || "Collection title";
  const effectiveDesc = v.seo_description.trim() || v.description.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Search engine listing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="truncate text-xs text-muted-foreground">
            {storeUrl}/collections/{effectiveHandle}
          </p>
          <p className="mt-1 truncate text-base text-[#1a0dab] dark:text-[#8ab4f8]">
            {effectiveTitle}
          </p>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {effectiveDesc || "Add a description to control what appears here."}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="seo-title">Page title</Label>
            <CharCount value={v.seo_title} max={TITLE_MAX} />
          </div>
          <Input
            id="seo-title"
            value={v.seo_title}
            onChange={(e) => store.set("seo_title", e.target.value)}
            placeholder={v.title || "Collection title"}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="seo-description">Meta description</Label>
            <CharCount value={v.seo_description} max={DESC_MAX} />
          </div>
          <Textarea
            id="seo-description"
            rows={3}
            value={v.seo_description}
            onChange={(e) => store.set("seo_description", e.target.value)}
            className="resize-y"
            placeholder={v.description || "Defaults to the collection description."}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="seo-handle">URL handle</Label>
          {editingHandle ? (
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <InputGroupText className="text-xs">/collections/</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="seo-handle"
                autoFocus
                value={v.handle}
                spellCheck={false}
                onChange={(e) => store.set("handle", handleize(e.target.value))}
                onBlur={() => setEditingHandle(false)}
              />
            </InputGroup>
          ) : (
            // Read-only until deliberately unlocked: the handle is a live URL,
            // and editing one by accident is a broken link nobody notices.
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate rounded-lg border border-transparent bg-muted/40 px-2.5 py-1 text-sm text-muted-foreground">
                /collections/{effectiveHandle}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  store.set("handle", effectiveHandle);
                  setEditingHandle(true);
                }}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
            </div>
          )}
          {editingHandle && (
            <p className="text-xs text-muted-foreground">
              Changing this breaks existing links to the collection.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
