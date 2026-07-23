import { createClient } from "@/lib/supabase/server";
import type {
  Collection,
  InventoryLevel,
  Product,
  ProductImage,
  ProductOption,
  ProductVariant,
} from "@/lib/types";

/**
 * Storefront data access.
 *
 * Everything here runs on the anon key and therefore through the public RLS
 * policies in 0003_storefront_public_read.sql — draft and archived products are
 * filtered by the database, not by this layer. The explicit `status` filters
 * below are belt-and-braces so a policy change can't silently expose drafts.
 */

/** A product with everything the grid and PDP need, stock already resolved. */
export interface ShopProduct extends Product {
  images: ProductImage[];
  options: ProductOption[];
  variants: ShopVariant[];
  /** Total stock across variants (or the product itself when it has none). */
  totalStock: number;
  inStock: boolean;
}

export interface ShopVariant extends ProductVariant {
  stock: number;
  available: boolean;
}

const PRODUCT_COLUMNS =
  "id,title,handle,description_html,status,vendor,product_type,category,tags,price,compare_at_price,cost_per_item,sku,barcode,track_inventory,continue_selling,requires_shipping,weight,weight_unit,country_of_origin,hs_code,has_variants,seo_title,seo_description,published_at,created_at,updated_at";

/**
 * Stock is summed across locations. A product that doesn't track inventory is
 * always purchasable, which mirrors how the admin treats `track_inventory`.
 */
function attachStock(
  product: Product,
  images: ProductImage[],
  options: ProductOption[],
  variants: ProductVariant[],
  levels: InventoryLevel[]
): ShopProduct {
  // Three ways a zero-stock item stays buyable: inventory isn't tracked, or the
  // product opts into overselling, or (per variant) the variant does.
  const untracked = !product.track_inventory || product.continue_selling;

  const shopVariants: ShopVariant[] = variants.map((v) => {
    const stock = levels
      .filter((l) => l.variant_id === v.id)
      .reduce((sum, l) => sum + l.quantity, 0);
    const sellable =
      !v.track_inventory || v.continue_selling || untracked || stock > 0;
    return {
      ...v,
      price: Number(v.price),
      compare_at_price: v.compare_at_price != null ? Number(v.compare_at_price) : null,
      cost_per_item: v.cost_per_item != null ? Number(v.cost_per_item) : null,
      stock,
      // `available` on the row is the operator's "sell this variant" switch; a
      // variant turned off is unavailable no matter how much stock it has.
      available: v.available && sellable,
    };
  });

  // Simple products carry their stock on the variant_id === null row.
  const simpleStock = levels
    .filter((l) => l.variant_id === null)
    .reduce((sum, l) => sum + l.quantity, 0);

  const totalStock = shopVariants.length
    ? shopVariants.reduce((sum, v) => sum + v.stock, 0)
    : simpleStock;

  const anyVariantSellable = shopVariants.some((v) => v.available);

  return {
    ...product,
    price: Number(product.price),
    compare_at_price:
      product.compare_at_price != null ? Number(product.compare_at_price) : null,
    images,
    options,
    variants: shopVariants,
    totalStock,
    inStock: shopVariants.length
      ? anyVariantSellable
      : untracked || totalStock > 0,
  };
}

/** Hydrates a set of products with images/options/variants/stock in one round trip each. */
async function hydrate(products: Product[]): Promise<ShopProduct[]> {
  if (!products.length) return [];
  const supabase = await createClient();
  const ids = products.map((p) => p.id);

  const [{ data: images }, { data: options }, { data: variants }, { data: levels }] =
    await Promise.all([
      supabase.from("product_images").select("*").in("product_id", ids).order("position"),
      supabase.from("product_options").select("*").in("product_id", ids).order("position"),
      supabase.from("product_variants").select("*").in("product_id", ids).order("position"),
      supabase.from("inventory_levels").select("*").in("product_id", ids),
    ]);

  const byProduct = <T extends { product_id: string }>(rows: T[] | null, id: string) =>
    (rows ?? []).filter((r) => r.product_id === id);

  return products.map((p) =>
    attachStock(
      p,
      byProduct(images as ProductImage[] | null, p.id),
      byProduct(options as ProductOption[] | null, p.id),
      byProduct(variants as ProductVariant[] | null, p.id),
      byProduct(levels as InventoryLevel[] | null, p.id)
    )
  );
}

export async function getCollections(): Promise<Collection[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("collections").select("*").order("created_at");
  return (data ?? []) as Collection[];
}

export async function getCollectionByHandle(handle: string): Promise<Collection | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("collections")
    .select("*")
    .eq("handle", handle)
    .maybeSingle();
  return (data as Collection) ?? null;
}

/**
 * Products in a collection. Manual collections resolve through the join table;
 * smart collections are evaluated against their rules the same way the admin
 * does it, so both types behave identically on the storefront.
 */
export async function getProductsInCollection(
  collection: Collection
): Promise<ShopProduct[]> {
  const supabase = await createClient();

  if (collection.type === "smart") {
    const { data } = await supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    const { productMatchesRules } = await import("@/lib/smart-collections");
    const matching = ((data ?? []) as Product[]).filter((p) =>
      productMatchesRules(p, collection.rules)
    );
    return hydrate(matching);
  }

  const { data: links } = await supabase
    .from("product_collections")
    .select("product_id")
    .eq("collection_id", collection.id);

  const ids = (links ?? []).map((l) => l.product_id as string);
  if (!ids.length) return [];

  const { data } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("status", "active")
    .in("id", ids)
    .order("created_at", { ascending: false });

  return hydrate((data ?? []) as Product[]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accepts either a handle (`/products/black-tee`) or a raw id.
 *
 * Handles are the canonical, shareable URL. Ids still resolve so that links
 * created before handles existed — and the admin's own internal links — keep
 * working instead of turning into 404s.
 */
export async function getProduct(idOrHandle: string): Promise<ShopProduct | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq(UUID.test(idOrHandle) ? "id" : "handle", idOrHandle)
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;
  const [hydrated] = await hydrate([data as Product]);
  return hydrated ?? null;
}

export async function getLatestProducts(limit = 8): Promise<ShopProduct[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);
  return hydrate((data ?? []) as Product[]);
}

/** Other active products, excluding one — used for "more from the drop". */
export async function getRelatedProducts(
  excludeId: string,
  limit = 4
): Promise<ShopProduct[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("status", "active")
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return hydrate((data ?? []) as Product[]);
}

export async function getStoreName(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shop_settings")
    .select("store_name")
    .maybeSingle();
  return data?.store_name ?? "Hazestudios";
}
