import { fromNumber } from "@/lib/number-input";
import type {
  InventoryLevel,
  Location,
  Product,
  ProductImage,
  ProductOption,
  ProductVariant,
} from "@/lib/types";
// Type-only import: erased at compile time, so pulling the draft shape in here
// does not drag the client module across the server boundary.
import type {
  OptionDraft,
  ProductDraft,
  VariantOverride,
} from "./product-draft";

export const emptyDraft: ProductDraft = {
  title: "",
  handle: "",
  description_html: "",
  status: "draft",
  vendor: "",
  product_type: "",
  category: "",
  tags: [],
  price: "",
  compare_at_price: "",
  cost_per_item: "",
  sku: "",
  barcode: "",
  track_inventory: true,
  continue_selling: false,
  requires_shipping: true,
  weight: "",
  weight_unit: "kg",
  country_of_origin: "",
  hs_code: "",
  seo_title: "",
  seo_description: "",
  published_at: null,
  images: [],
  options: [],
  variantOverrides: {},
  collection_ids: [],
  inventory: {},
};

/** Deterministic option keys, so a server render and its hydration agree. */
function optionKey(productId: string, index: number) {
  return `${productId}-option-${index}`;
}

export function draftFromProduct({
  product,
  images,
  options,
  variants,
  inventory,
  collectionIds,
  locations,
}: {
  product: Product;
  images: ProductImage[];
  options: ProductOption[];
  variants: ProductVariant[];
  inventory: InventoryLevel[];
  collectionIds: string[];
  locations: Location[];
}): ProductDraft {
  const locationIds = new Set(locations.map((l) => l.id));

  // Every variant is stored as an explicit override. Round-tripping a saved
  // product must not silently re-inherit the parent's price and lose a
  // per-variant one the operator set earlier.
  const variantOverrides: Record<string, VariantOverride> = {};
  for (const v of variants) {
    const perLocation: Record<string, number> = {};
    for (const level of inventory) {
      if (level.variant_id === v.id && locationIds.has(level.location_id)) {
        perLocation[level.location_id] = level.quantity;
      }
    }
    variantOverrides[v.title] = {
      price: fromNumber(Number(v.price)),
      compare_at_price: fromNumber(
        v.compare_at_price != null ? Number(v.compare_at_price) : null
      ),
      cost_per_item: fromNumber(
        v.cost_per_item != null ? Number(v.cost_per_item) : null
      ),
      sku: v.sku,
      barcode: v.barcode,
      weight: fromNumber(v.weight != null ? Number(v.weight) : null),
      available: v.available,
      image_id: v.image_id,
      inventory: perLocation,
    };
  }

  const simpleInventory: Record<string, number> = {};
  for (const level of inventory) {
    if (level.variant_id === null && locationIds.has(level.location_id)) {
      simpleInventory[level.location_id] = level.quantity;
    }
  }

  const optionDrafts: OptionDraft[] = options
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((o, i) => ({
      key: optionKey(product.id, i),
      name: o.name,
      values: o.values,
    }));

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description_html: product.description_html,
    status: product.status,
    vendor: product.vendor,
    product_type: product.product_type,
    category: product.category,
    tags: product.tags,
    price: fromNumber(Number(product.price)),
    compare_at_price: fromNumber(
      product.compare_at_price != null ? Number(product.compare_at_price) : null
    ),
    cost_per_item: fromNumber(
      product.cost_per_item != null ? Number(product.cost_per_item) : null
    ),
    sku: product.sku,
    barcode: product.barcode,
    track_inventory: product.track_inventory,
    continue_selling: product.continue_selling,
    requires_shipping: product.requires_shipping,
    weight: fromNumber(product.weight != null ? Number(product.weight) : null),
    weight_unit: product.weight_unit,
    country_of_origin: product.country_of_origin,
    hs_code: product.hs_code,
    seo_title: product.seo_title,
    seo_description: product.seo_description,
    published_at: product.published_at,
    images: images
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((img) => ({
        id: img.id,
        url: img.url,
        alt: img.alt,
        status: "ready" as const,
      })),
    options: optionDrafts,
    variantOverrides,
    collection_ids: collectionIds,
    inventory: simpleInventory,
  };
}
