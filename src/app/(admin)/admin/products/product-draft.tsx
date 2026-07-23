"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { FormStore } from "@/lib/form-store";
import { toAmount, toNumber } from "@/lib/number-input";
import type { DraftImage } from "@/components/admin/media-uploader";
import type { Location, ProductStatus, WeightUnit } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Draft shape                                                                 */
/* -------------------------------------------------------------------------- */

export interface OptionDraft {
  /** stable across renames, so React keys and overrides survive editing */
  key: string;
  name: string;
  values: string[];
}

/**
 * Per-variant divergence from the product-level defaults. Only keys the operator
 * actually touched are stored — everything else falls through to the parent, so
 * changing the base price still moves untouched variants with it.
 */
export interface VariantOverride {
  price?: string;
  compare_at_price?: string;
  cost_per_item?: string;
  sku?: string;
  barcode?: string;
  weight?: string;
  available?: boolean;
  image_id?: string | null;
  /** locationId → quantity */
  inventory?: Record<string, number>;
}

/**
 * Money and weight live as strings, not numbers. A numeric state field fights
 * the input: typing "10." or clearing the box round-trips through NaN and the
 * cursor jumps. Parsing happens once, at save.
 */
export interface ProductDraft extends Record<string, unknown> {
  id?: string;
  title: string;
  handle: string;
  description_html: string;
  status: ProductStatus;
  vendor: string;
  product_type: string;
  category: string;
  tags: string[];
  price: string;
  compare_at_price: string;
  cost_per_item: string;
  sku: string;
  barcode: string;
  track_inventory: boolean;
  continue_selling: boolean;
  requires_shipping: boolean;
  weight: string;
  weight_unit: WeightUnit;
  country_of_origin: string;
  hs_code: string;
  seo_title: string;
  seo_description: string;
  published_at: string | null;
  images: DraftImage[];
  options: OptionDraft[];
  variantOverrides: Record<string, VariantOverride>;
  collection_ids: string[];
  /** simple-product stock: locationId → quantity */
  inventory: Record<string, number>;
}

/* -------------------------------------------------------------------------- */
/* Variant derivation                                                          */
/* -------------------------------------------------------------------------- */

export interface VariantRow {
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price: string;
  compare_at_price: string;
  cost_per_item: string;
  sku: string;
  barcode: string;
  weight: string;
  available: boolean;
  image_id: string | null;
  inventory: Record<string, number>;
  /** true when this row has its own value for the field, not the parent's */
  overridden: (keyof VariantOverride)[];
}

/** Every combination of the filled-in options, in option order. */
export function cartesian(options: OptionDraft[]): string[][] {
  const lists = options
    .filter((o) => o.name.trim() && o.values.length > 0)
    .map((o) => o.values);
  if (!lists.length) return [];
  return lists.reduce<string[][]>(
    (acc, values) => acc.flatMap((combo) => values.map((v) => [...combo, v])),
    [[]]
  );
}

export function variantTitle(combo: string[]): string {
  return combo.join(" / ");
}

export function deriveVariants(draft: ProductDraft): VariantRow[] {
  return cartesian(draft.options).map((combo) => {
    const title = variantTitle(combo);
    const o = draft.variantOverrides[title] ?? {};
    return {
      title,
      option1: combo[0] ?? null,
      option2: combo[1] ?? null,
      option3: combo[2] ?? null,
      price: o.price ?? draft.price,
      compare_at_price: o.compare_at_price ?? draft.compare_at_price,
      cost_per_item: o.cost_per_item ?? draft.cost_per_item,
      sku: o.sku ?? "",
      barcode: o.barcode ?? "",
      weight: o.weight ?? draft.weight,
      available: o.available ?? true,
      image_id: o.image_id ?? null,
      inventory: o.inventory ?? {},
      overridden: (Object.keys(o) as (keyof VariantOverride)[]).filter(
        (k) => o[k] !== undefined
      ),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Payload for save_product(jsonb)                                             */
/* -------------------------------------------------------------------------- */

export function toPayload(draft: ProductDraft, locations: Location[]) {
  const variants = deriveVariants(draft);
  const hasVariants = variants.length > 0;

  return {
    id: draft.id ?? null,
    title: draft.title.trim(),
    handle: draft.handle.trim(),
    description_html: draft.description_html,
    status: draft.status,
    vendor: draft.vendor.trim(),
    product_type: draft.product_type.trim(),
    category: draft.category.trim(),
    tags: draft.tags,
    price: toAmount(draft.price),
    compare_at_price: toNumber(draft.compare_at_price),
    cost_per_item: toNumber(draft.cost_per_item),
    sku: draft.sku.trim(),
    barcode: draft.barcode.trim(),
    track_inventory: draft.track_inventory,
    continue_selling: draft.continue_selling,
    requires_shipping: draft.requires_shipping,
    weight: draft.requires_shipping ? toNumber(draft.weight) : null,
    weight_unit: draft.weight_unit,
    country_of_origin: draft.country_of_origin.trim(),
    hs_code: draft.hs_code.trim(),
    seo_title: draft.seo_title.trim(),
    seo_description: draft.seo_description.trim(),
    published_at: draft.status === "active" ? (draft.published_at ?? new Date().toISOString()) : null,

    images: draft.images.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt,
    })),

    options: draft.options
      .filter((o) => o.name.trim() && o.values.length > 0)
      .map((o) => ({ name: o.name.trim(), values: o.values })),

    variants: variants.map((v) => ({
      title: v.title,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      price: toAmount(v.price),
      compare_at_price: toNumber(v.compare_at_price),
      cost_per_item: toNumber(v.cost_per_item),
      sku: v.sku.trim(),
      barcode: v.barcode.trim(),
      weight: draft.requires_shipping ? toNumber(v.weight) : null,
      weight_unit: draft.weight_unit,
      requires_shipping: draft.requires_shipping,
      track_inventory: draft.track_inventory,
      continue_selling: draft.continue_selling,
      available: v.available,
      image_id: v.image_id,
      // Always send every location, so a location zeroed in the UI actually
      // writes 0 rather than being pruned as "not mentioned".
      inventory: draft.track_inventory
        ? locations.map((loc) => ({
            location_id: loc.id,
            quantity: v.inventory[loc.id] ?? 0,
          }))
        : [],
    })),

    inventory:
      !hasVariants && draft.track_inventory
        ? locations.map((loc) => ({
            location_id: loc.id,
            quantity: draft.inventory[loc.id] ?? 0,
          }))
        : [],

    collection_ids: draft.collection_ids,
  };
}

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

export type ProductStore = FormStore<ProductDraft>;

const StoreContext = createContext<ProductStore | null>(null);

export function ProductDraftProvider({
  initial,
  children,
}: {
  initial: ProductDraft;
  children: ReactNode;
}) {
  // Created exactly once per mount, not per `initial` identity: a server
  // re-render (say, from router.refresh() after a save) hands down a
  // structurally-equal but referentially-new object, and rebuilding the store
  // there would throw away the operator's in-progress edits. Remounting for a
  // genuinely different product is handled by `key` at the call site.
  // Lazy `useState` rather than a ref: it is the idiomatic create-once-per-mount
  // hook, and unlike a ref it is legal to read during render.
  const [store] = useState(() => new FormStore<ProductDraft>(initial));
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useProductStore(): ProductStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useProductStore must be used inside <ProductDraftProvider>");
  }
  return store;
}
