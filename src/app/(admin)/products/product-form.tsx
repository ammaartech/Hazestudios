"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MediaUploader, type DraftImage } from "@/components/admin/media-uploader";
import { PageHeader } from "@/components/admin/page-header";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { TagsInput } from "@/components/admin/tags-input";
import { formatMoney } from "@/lib/format";
import type { Collection, Location, ProductStatus } from "@/lib/types";
import {
  saveProduct,
  deleteProduct,
  type ProductPayload,
  type VariantPayload,
} from "./actions";

interface OptionDraft {
  key: string;
  name: string;
  values: string[];
}

interface VariantDraft extends VariantPayload {
  key: string;
}

export interface ProductFormInitial {
  id?: string;
  title: string;
  description_html: string;
  status: ProductStatus;
  vendor: string;
  product_type: string;
  tags: string[];
  price: number;
  compare_at_price: number | null;
  cost_per_item: number | null;
  sku: string;
  barcode: string;
  track_inventory: boolean;
  seo_title: string;
  seo_description: string;
  images: DraftImage[];
  options: { name: string; values: string[] }[];
  variants: VariantPayload[];
  collection_ids: string[];
  inventory: { location_id: string; quantity: number }[];
}

export const emptyProduct: ProductFormInitial = {
  title: "",
  description_html: "",
  status: "draft",
  vendor: "",
  product_type: "",
  tags: [],
  price: 0,
  compare_at_price: null,
  cost_per_item: null,
  sku: "",
  barcode: "",
  track_inventory: true,
  seo_title: "",
  seo_description: "",
  images: [],
  options: [],
  variants: [],
  collection_ids: [],
  inventory: [],
};

function cartesian(options: OptionDraft[]): string[][] {
  const lists = options
    .filter((o) => o.name.trim() && o.values.length)
    .map((o) => o.values);
  if (!lists.length) return [];
  return lists.reduce<string[][]>(
    (acc, values) => acc.flatMap((combo) => values.map((v) => [...combo, v])),
    [[]]
  );
}

function num(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export function ProductForm({
  initial,
  collections,
  locations,
}: {
  initial: ProductFormInitial;
  collections: Collection[];
  locations: Location[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description_html);
  const [status, setStatus] = useState<ProductStatus>(initial.status);
  const [vendor, setVendor] = useState(initial.vendor);
  const [productType, setProductType] = useState(initial.product_type);
  const [tags, setTags] = useState(initial.tags);
  const [price, setPrice] = useState(String(initial.price || ""));
  const [compareAt, setCompareAt] = useState(
    initial.compare_at_price != null ? String(initial.compare_at_price) : ""
  );
  const [cost, setCost] = useState(
    initial.cost_per_item != null ? String(initial.cost_per_item) : ""
  );
  const [sku, setSku] = useState(initial.sku);
  const [barcode, setBarcode] = useState(initial.barcode);
  const [trackInventory, setTrackInventory] = useState(initial.track_inventory);
  const [seoTitle, setSeoTitle] = useState(initial.seo_title);
  const [seoDescription, setSeoDescription] = useState(initial.seo_description);
  const [images, setImages] = useState<DraftImage[]>(initial.images);
  const [collectionIds, setCollectionIds] = useState<string[]>(
    initial.collection_ids
  );
  const [options, setOptions] = useState<OptionDraft[]>(
    initial.options.map((o) => ({ ...o, key: crypto.randomUUID() }))
  );
  const [variantEdits, setVariantEdits] = useState<Map<string, VariantDraft>>(
    () =>
      new Map(
        initial.variants.map((v) => [
          v.title,
          { ...v, key: crypto.randomUUID() },
        ])
      )
  );
  const [inventory, setInventory] = useState<Map<string, number>>(
    () =>
      new Map(
        locations.map((loc) => [
          loc.id,
          initial.inventory.find((i) => i.location_id === loc.id)?.quantity ?? 0,
        ])
      )
  );

  const combos = useMemo(() => cartesian(options), [options]);

  const variants: VariantDraft[] = useMemo(
    () =>
      combos.map((combo) => {
        const key = combo.join(" / ");
        const existing = variantEdits.get(key);
        return (
          existing ?? {
            key,
            title: key,
            option1: combo[0] ?? null,
            option2: combo[1] ?? null,
            option3: combo[2] ?? null,
            price: num(price),
            compare_at_price: null,
            sku: "",
            barcode: "",
            quantity: 0,
          }
        );
      }),
    [combos, variantEdits, price]
  );

  function updateVariant(v: VariantDraft, patch: Partial<VariantDraft>) {
    setVariantEdits((prev) => {
      const next = new Map(prev);
      next.set(v.title, { ...v, ...patch });
      return next;
    });
  }

  const profit =
    cost && price ? num(price) - num(cost) : null;
  const margin =
    profit != null && num(price) > 0
      ? Math.round((profit / num(price)) * 100)
      : null;

  function handleSave() {
    const payload: ProductPayload = {
      id: initial.id,
      title,
      description_html: description,
      status,
      vendor,
      product_type: productType,
      tags,
      price: num(price),
      compare_at_price: compareAt ? num(compareAt) : null,
      cost_per_item: cost ? num(cost) : null,
      sku,
      barcode,
      track_inventory: trackInventory,
      seo_title: seoTitle,
      seo_description: seoDescription,
      images: images.map((i) => ({ url: i.url, alt: i.alt })),
      options: options
        .filter((o) => o.name.trim() && o.values.length)
        .map((o) => ({ name: o.name.trim(), values: o.values })),
      variants: variants.map(({ key: _key, ...rest }) => rest),
      collection_ids: collectionIds,
      inventory: locations.map((loc) => ({
        location_id: loc.id,
        quantity: inventory.get(loc.id) ?? 0,
      })),
    };

    startTransition(async () => {
      const result = await saveProduct(payload);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(initial.id ? "Product updated" : "Product created");
      router.push("/products");
      router.refresh();
    });
  }

  function handleDelete() {
    if (!initial.id) return;
    if (!window.confirm("Delete this product? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteProduct(initial.id!);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Product deleted");
      router.push("/products");
      router.refresh();
    });
  }

  return (
    <div>
      <PageHeader
        title={initial.id ? title || "Edit product" : "Add product"}
        backHref="/products"
        backLabel="Products"
      >
        {initial.id && (
          <Button
            variant="outline"
            onClick={handleDelete}
            disabled={pending}
            className="text-destructive hover:text-destructive"
          >
            Delete
          </Button>
        )}
        <Button onClick={handleSave} disabled={pending || !title.trim()}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Main column */}
        <div className="space-y-5">
          <Card>
            <CardContent className="space-y-4 pt-0">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short sleeve t-shirt"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <RichTextEditor value={description} onChange={setDescription} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Media</CardTitle>
            </CardHeader>
            <CardContent>
              <MediaUploader images={images} onChange={setImages} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pricing</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="price">Price</Label>
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="compare-at">Compare-at price</Label>
                <Input
                  id="compare-at"
                  type="number"
                  min="0"
                  step="0.01"
                  value={compareAt}
                  onChange={(e) => setCompareAt(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cost">Cost per item</Label>
                <Input
                  id="cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00"
                />
                {profit != null && (
                  <p className="text-xs text-muted-foreground">
                    Profit {formatMoney(profit)}
                    {margin != null ? ` · Margin ${margin}%` : ""}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Inventory</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sku">SKU (Stock Keeping Unit)</Label>
                  <Input
                    id="sku"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="barcode">Barcode (ISBN, UPC, GTIN)</Label>
                  <Input
                    id="barcode"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="track-inventory"
                  checked={trackInventory}
                  onCheckedChange={setTrackInventory}
                />
                <Label htmlFor="track-inventory">Track quantity</Label>
              </div>
              {trackInventory && combos.length === 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Quantity by location</p>
                  {locations.map((loc) => (
                    <div
                      key={loc.id}
                      className="flex items-center justify-between gap-4"
                    >
                      <span className="text-sm text-muted-foreground">
                        {loc.name}
                        {loc.is_default ? " (default)" : ""}
                      </span>
                      <Input
                        type="number"
                        min="0"
                        aria-label={`Quantity at ${loc.name}`}
                        className="w-28"
                        value={inventory.get(loc.id) ?? 0}
                        onChange={(e) =>
                          setInventory((prev) => {
                            const next = new Map(prev);
                            next.set(loc.id, parseInt(e.target.value) || 0);
                            return next;
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Variants</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setOptions([
                    ...options,
                    { key: crypto.randomUUID(), name: "", values: [] },
                  ])
                }
                disabled={options.length >= 3}
              >
                <Plus className="size-4" />
                Add option
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {options.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Add options like size or color to sell multiple versions of
                  this product.
                </p>
              )}
              {options.map((opt) => (
                <div
                  key={opt.key}
                  className="rounded-md border border-input p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Input
                      value={opt.name}
                      placeholder="Option name (e.g. Size)"
                      aria-label="Option name"
                      onChange={(e) =>
                        setOptions(
                          options.map((o) =>
                            o.key === opt.key ? { ...o, name: e.target.value } : o
                          )
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove option"
                      onClick={() =>
                        setOptions(options.filter((o) => o.key !== opt.key))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <TagsInput
                    value={opt.values}
                    placeholder="Add a value (e.g. Small) and press Enter"
                    onChange={(values) =>
                      setOptions(
                        options.map((o) =>
                          o.key === opt.key ? { ...o, values } : o
                        )
                      )
                    }
                  />
                </div>
              ))}

              {variants.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-input">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left">
                        <th className="px-3 py-2 font-medium">Variant</th>
                        <th className="px-3 py-2 font-medium">Price</th>
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((v) => (
                        <tr key={v.key} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{v.title}</td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              aria-label={`Price for ${v.title}`}
                              className="h-8 w-24"
                              value={v.price}
                              onChange={(e) =>
                                updateVariant(v, { price: num(e.target.value) })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              aria-label={`SKU for ${v.title}`}
                              className="h-8 w-28"
                              value={v.sku}
                              onChange={(e) =>
                                updateVariant(v, { sku: e.target.value })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min="0"
                              aria-label={`Quantity for ${v.title}`}
                              className="h-8 w-20"
                              value={v.quantity}
                              onChange={(e) =>
                                updateVariant(v, {
                                  quantity: parseInt(e.target.value) || 0,
                                })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Search engine listing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="seo-title">Page title</Label>
                <Input
                  id="seo-title"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder={title}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="seo-description">Meta description</Label>
                <Input
                  id="seo-description"
                  value={seoDescription}
                  onChange={(e) => setSeoDescription(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as ProductStatus)}
              >
                <SelectTrigger aria-label="Product status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organization</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="product-type">Product type</Label>
                <Input
                  id="product-type"
                  value={productType}
                  onChange={(e) => setProductType(e.target.value)}
                  placeholder="e.g. Shirts"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor">Vendor</Label>
                <Input
                  id="vendor"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="e.g. Hazestudios"
                />
              </div>
              <div className="space-y-2">
                <Label>Collections</Label>
                {collections.filter((c) => c.type === "manual").length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No manual collections yet. Smart collections pick up
                    products automatically from their rules.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {collections
                      .filter((c) => c.type === "manual")
                      .map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={collectionIds.includes(c.id)}
                            onCheckedChange={(checked) =>
                              setCollectionIds(
                                checked
                                  ? [...collectionIds, c.id]
                                  : collectionIds.filter((id) => id !== c.id)
                              )
                            }
                          />
                          {c.title}
                        </label>
                      ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Tags</Label>
                <TagsInput value={tags} onChange={setTags} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={handleSave} disabled={pending || !title.trim()}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
