import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import {
  CATALOG_TAG,
  COLLECTIONS_TAG,
  SETTINGS_TAG,
  cachedCatalogRead,
  productTag,
} from "./cache";
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
 *
 * Two properties this module has to hold, because a storefront is read-mostly
 * and spiky — a drop is a thousand people asking for the same hoodie inside a
 * minute:
 *
 *   * **One product is one round trip.** Product, images, options, variants and
 *     stock arrive together as an embedded select rather than as five parallel
 *     `.in()` queries. See `PRODUCT_SELECT`.
 *   * **One product is one round trip *in total*, not per viewer.** Every
 *     exported read is wrapped twice: `cachedCatalogRead` shares the result
 *     across requests until a write invalidates its tag, and React `cache`
 *     dedupes repeat calls inside a single render pass — which is what stops a
 *     PDP fetching its own product once for `generateMetadata` and again for
 *     the page body.
 *
 * Neither wrapper may touch a request API, so these read through
 * `createPublicClient` (cookie-blind) rather than `@/lib/supabase/server`.
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
  "id,title,handle,description_html,status,vendor,product_type,category,tags,price,compare_at_price,cost_per_item,sku,barcode,track_inventory,continue_selling,requires_shipping,weight,weight_unit,country_of_origin,hs_code,has_variants,seo_title,seo_description,published_at,size_chart_enabled,size_chart,created_at,updated_at";

/**
 * The whole product graph in one statement.
 *
 * PostgREST resolves each of these against the foreign key the child table
 * already declares on `products (id)` (0001_init.sql), so the four child tables
 * come back nested instead of as four more queries to stitch together in JS.
 * That is the difference between a PDP costing five round trips and one — and
 * five *sequential* network hops to Supabase dominate the page's server time
 * far more than the queries themselves, none of which touch more than a handful
 * of rows.
 *
 * Ordering is applied in JS rather than with `referencedTable` because a
 * product has a dozen images and a handful of variants; sorting them here costs
 * nothing and keeps one sort path for embedded and non-embedded callers alike.
 */
const PRODUCT_SELECT = `${PRODUCT_COLUMNS},product_images(*),product_options(*),product_variants(*),inventory_levels(*)`;

interface ProductRow extends Product {
  product_images: ProductImage[] | null;
  product_options: ProductOption[] | null;
  product_variants: ProductVariant[] | null;
  inventory_levels: InventoryLevel[] | null;
}

const byPosition = <T extends { position: number }>(rows: T[] | null): T[] =>
  [...(rows ?? [])].sort((a, b) => a.position - b.position);

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

/** Flattens one embedded row into the shape the storefront components expect. */
function toShopProduct(row: ProductRow): ShopProduct {
  const { product_images, product_options, product_variants, inventory_levels, ...product } =
    row;

  return attachStock(
    product as Product,
    byPosition(product_images),
    byPosition(product_options),
    byPosition(product_variants),
    inventory_levels ?? []
  );
}

/** The base storefront query: active products, fully embedded. */
function activeProducts() {
  return createPublicClient()
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("status", "active");
}

const rowsToProducts = (data: unknown): ShopProduct[] =>
  ((data ?? []) as ProductRow[]).map(toShopProduct);

/* -------------------------------------------------------------------------- */
/* Collections                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Published collections only.
 *
 * RLS already hides unpublished ones from `anon`, but the explicit filter stays
 * for the reason it always did — and now for a second one. A scheduled
 * `published_at` is compared against `now()` *at cache-fill time*, so a drop
 * scheduled to the minute goes live within `CATALOG_TTL` of its timestamp
 * rather than exactly on it. That is the price of not asking Postgres on every
 * page view; if a launch ever needs to be second-accurate, invalidate the
 * `collections` tag from the job that publishes it.
 */
export const getCollections = cache(
  cachedCatalogRead(
    "shop:getCollections",
    async (): Promise<Collection[]> => {
      const { data } = await createPublicClient()
        .from("collections")
        .select("*")
        .not("published_at", "is", null)
        .lte("published_at", new Date().toISOString())
        .order("created_at");
      return (data ?? []) as Collection[];
    },
    [COLLECTIONS_TAG]
  )
);

export const getCollectionByHandle = cache(
  cachedCatalogRead(
    "shop:getCollectionByHandle",
    async (handle: string): Promise<Collection | null> => {
      const { data } = await createPublicClient()
        .from("collections")
        .select("*")
        .eq("handle", handle)
        .not("published_at", "is", null)
        .lte("published_at", new Date().toISOString())
        .maybeSingle();
      return (data as Collection) ?? null;
    },
    [COLLECTIONS_TAG]
  )
);

/**
 * Applies the merchant's chosen ordering.
 *
 * `manual` is the only mode that consults `manualOrder` — the positions stored
 * on product_collections. Everything else is derived, so it stays correct as
 * the catalogue changes without anyone revisiting the collection.
 */
function sortProducts<T extends Product>(
  products: T[],
  sort: Collection["sort_order"],
  manualOrder?: Map<string, number>
): T[] {
  const rows = [...products];

  switch (sort) {
    case "alpha_asc":
      return rows.sort((a, b) => a.title.localeCompare(b.title));
    case "alpha_desc":
      return rows.sort((a, b) => b.title.localeCompare(a.title));
    case "price_asc":
      return rows.sort((a, b) => Number(a.price) - Number(b.price));
    case "price_desc":
      return rows.sort((a, b) => Number(b.price) - Number(a.price));
    case "created_asc":
      return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    case "created_desc":
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case "manual":
    default:
      // A smart collection has no manual order to consult, and a product added
      // outside the stored positions sorts last rather than jumping to front.
      if (!manualOrder) {
        return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      return rows.sort(
        (a, b) =>
          (manualOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (manualOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      );
  }
}

/**
 * Products in a collection. Manual collections resolve through the join table;
 * smart collections are evaluated against their rules the same way the admin
 * does it, so both types behave identically on the storefront.
 *
 * Two round trips either way. The smart branch deliberately reads bare columns
 * first and only embeds the matches: rule evaluation needs every active
 * product, and pulling the whole catalogue's images, variants and stock just to
 * discard most of it is far more expensive than the extra hop.
 */
export const getProductsInCollection = cache(
  cachedCatalogRead(
    "shop:getProductsInCollection",
    async (collection: Collection): Promise<ShopProduct[]> => {
      const supabase = createPublicClient();

      if (collection.type === "smart") {
        const { data } = await supabase
          .from("products")
          .select(PRODUCT_COLUMNS)
          .eq("status", "active");

        const { productMatchesRules } = await import("@/lib/smart-collections");
        const matching = ((data ?? []) as Product[]).filter((p) =>
          productMatchesRules(p, collection.rules)
        );
        if (!matching.length) return [];

        const { data: embedded } = await activeProducts().in(
          "id",
          matching.map((p) => p.id)
        );

        return sortProducts(rowsToProducts(embedded), collection.sort_order);
      }

      const { data: links } = await supabase
        .from("product_collections")
        .select("product_id, position")
        .eq("collection_id", collection.id)
        .order("position");

      const rows = (links ?? []) as { product_id: string; position: number }[];
      if (!rows.length) return [];

      const manualOrder = new Map(rows.map((l) => [l.product_id, l.position]));

      const { data } = await activeProducts().in(
        "id",
        rows.map((l) => l.product_id)
      );

      return sortProducts(
        rowsToProducts(data),
        collection.sort_order,
        manualOrder
      );
    },
    [CATALOG_TAG, COLLECTIONS_TAG]
  )
);

/* -------------------------------------------------------------------------- */
/* Products                                                                    */
/* -------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readProduct(idOrHandle: string): Promise<ShopProduct | null> {
  const { data } = await activeProducts()
    .eq(UUID.test(idOrHandle) ? "id" : "handle", idOrHandle)
    .maybeSingle();

  return data ? toShopProduct(data as unknown as ProductRow) : null;
}

/**
 * Accepts either a handle (`/products/black-tee`) or a raw id.
 *
 * Handles are the canonical, shareable URL. Ids still resolve so that links
 * created before handles existed — and the admin's own internal links — keep
 * working instead of turning into 404s.
 *
 * The cache wrapper is built per call so the entry can carry a tag naming *this
 * product*. An edit to one hoodie then drops one entry rather than the whole
 * catalogue. `readProduct` is a stable module-level function, so the cache key
 * — derived from it, the name, and the argument — is stable too. React `cache`
 * sits outside so `generateMetadata` and the page body share one lookup within
 * a request even on a cache miss.
 */
export const getProduct = cache(
  async (idOrHandle: string): Promise<ShopProduct | null> =>
    cachedCatalogRead("shop:getProduct", readProduct, [
      CATALOG_TAG,
      productTag(idOrHandle),
    ])(idOrHandle)
);

/**
 * Products by id, hydrated. The cart's resolution step — a cart line stores a
 * reference, so every read has to look the product up again to get today's
 * price and stock. Anything that has since been unpublished simply doesn't come
 * back, which is how a cart drops a line that is no longer for sale.
 *
 * Ids are sorted before they reach the cache so that two carts holding the same
 * two products in different orders share one entry instead of minting two.
 */
const readProductsByIds = cachedCatalogRead(
  "shop:getProductsByIds",
  async (ids: string[]): Promise<ShopProduct[]> => {
    const { data } = await activeProducts().in("id", ids);
    return rowsToProducts(data);
  }
);

export const getProductsByIds = cache(
  async (ids: string[]): Promise<ShopProduct[]> => {
    if (!ids.length) return [];
    return readProductsByIds([...new Set(ids)].sort());
  }
);

export const getLatestProducts = cache(
  cachedCatalogRead(
    "shop:getLatestProducts",
    async (limit: number = 8): Promise<ShopProduct[]> => {
      const { data } = await activeProducts()
        .order("created_at", { ascending: false })
        .limit(limit);
      return rowsToProducts(data);
    }
  )
);

/** Other active products, excluding one — used for "more from the drop". */
export const getRelatedProducts = cache(
  cachedCatalogRead(
    "shop:getRelatedProducts",
    async (excludeId: string, limit: number = 4): Promise<ShopProduct[]> => {
      const { data } = await activeProducts()
        .neq("id", excludeId)
        .order("created_at", { ascending: false })
        .limit(limit);
      return rowsToProducts(data);
    }
  )
);

/**
 * Free-text product search over title, type and vendor.
 *
 * `%` and `_` are escaped before the term reaches `ilike`, so a shopper typing
 * "100% cotton" searches for that string rather than for a wildcard. Postgres
 * treats a lone `\` in a LIKE pattern as an escape, so it is doubled first.
 *
 * Normalised to lower case before caching: `ilike` is case-insensitive, so
 * "Hoodie" and "hoodie" are the same query and should not be two cache entries.
 */
const readSearch = cachedCatalogRead(
  "shop:searchProducts",
  async (query: string, limit: number): Promise<ShopProduct[]> => {
    const escaped = query.replace(/\\/g, "\\\\").replace(/[%_]/g, (c) => `\\${c}`);
    const pattern = `%${escaped}%`;

    const { data } = await activeProducts()
      .or(
        `title.ilike.${pattern},product_type.ilike.${pattern},vendor.ilike.${pattern}`
      )
      .limit(limit);

    return rowsToProducts(data);
  }
);

export const searchProducts = cache(
  async (term: string, limit = 24): Promise<ShopProduct[]> => {
    const query = term.trim();
    if (query.length < 2) return [];
    return readSearch(query.toLowerCase(), limit);
  }
);

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export const getStoreName = cache(
  cachedCatalogRead(
    "shop:getStoreName",
    async (): Promise<string> => {
      const { data } = await createPublicClient()
        .from("shop_settings")
        .select("store_name")
        .maybeSingle();
      return data?.store_name ?? "Fogstores";
    },
    [SETTINGS_TAG]
  )
);
