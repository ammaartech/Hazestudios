import "server-only";
import { cacheLife, cacheTag, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { COLLECTIONS_TAG, SETTINGS_TAG, CATALOG_TAG } from "@/lib/shop/cache";
import type { Collection, Location, ShopSettings } from "@/lib/types";
import type { ProductFacets } from "@/app/(admin)/admin/products/actions";

/**
 * The admin's reference data — the handful of shop-wide rows nearly every page
 * reads and almost nothing writes: settings, locations, the collection list,
 * product facets. Before this, each page fetched them again from Tokyo on
 * every render (the product editor alone made four such requests).
 *
 * Cached with `'use cache: remote'`, so the entries and their tag timestamps
 * are shared across Vercel instances (see `cache-handlers/upstash.cjs`), and
 * read through the service role because a cached function cannot see the
 * request's cookies. That is safe on two conditions, both of which hold: the
 * data is shop-wide rather than per-user, and every caller sits behind the
 * staff gate in `src/proxy.ts`. `shop_settings` is even publicly readable on
 * the storefront's anon policy.
 *
 * Freshness is by tag. The Server Actions that write these rows call the
 * `revalidate*` helpers below (and the storefront's in `lib/shop/cache.ts`),
 * which expire the entries everywhere at once; the `reference` profile's
 * revalidate window only covers edits made outside the app.
 *
 * Without a service-role key the cached path returns nothing and each reader
 * falls back to a plain cookie-scoped read, so a missing env var costs
 * latency, not correctness.
 */

export const LOCATIONS_TAG = "locations";
export const FACETS_TAG = "product-facets";

const EMPTY_FACETS: ProductFacets = {
  tags: [],
  vendors: [],
  types: [],
  categories: [],
  metafield_keys: [],
};

/* -------------------------------------------------------------------------- */
/* Cached readers (service role)                                               */
/* -------------------------------------------------------------------------- */

async function cachedSettings(): Promise<ShopSettings | null> {
  "use cache: remote";
  cacheLife("reference");
  cacheTag(SETTINGS_TAG);
  const db = createAdminClient();
  if (!db) return null;
  const { data } = await db.from("shop_settings").select("*").limit(1).maybeSingle();
  return (data as ShopSettings | null) ?? null;
}

async function cachedLocations(): Promise<Location[] | null> {
  "use cache: remote";
  cacheLife("reference");
  cacheTag(LOCATIONS_TAG);
  const db = createAdminClient();
  if (!db) return null;
  const { data } = await db.from("locations").select("*").order("created_at");
  return (data as Location[] | null) ?? [];
}

async function cachedCollections(): Promise<Collection[] | null> {
  "use cache: remote";
  cacheLife("reference");
  cacheTag(COLLECTIONS_TAG);
  cacheTag(CATALOG_TAG);
  const db = createAdminClient();
  if (!db) return null;
  const { data } = await db.from("collections").select("*").order("title");
  return (data as Collection[] | null) ?? [];
}

async function cachedFacets(): Promise<ProductFacets | null> {
  "use cache: remote";
  cacheLife("reference");
  cacheTag(FACETS_TAG);
  cacheTag(CATALOG_TAG);
  const db = createAdminClient();
  if (!db) return null;
  const { data, error } = await db.rpc("product_facets");
  if (error || !data) return EMPTY_FACETS;
  return data as ProductFacets;
}

/* -------------------------------------------------------------------------- */
/* Public readers                                                              */
/* -------------------------------------------------------------------------- */

export async function getShopSettings(): Promise<ShopSettings | null> {
  const cached = await cachedSettings();
  if (cached) return cached;
  const supabase = await createClient();
  const { data } = await supabase.from("shop_settings").select("*").limit(1).maybeSingle();
  return (data as ShopSettings | null) ?? null;
}

/** The store's reporting currency; "INR" until settings say otherwise. */
export async function getShopCurrency(): Promise<string> {
  return (await getShopSettings())?.currency ?? "INR";
}

export async function getLocations(): Promise<Location[]> {
  const cached = await cachedLocations();
  if (cached) return cached;
  const supabase = await createClient();
  const { data } = await supabase.from("locations").select("*").order("created_at");
  return (data as Location[] | null) ?? [];
}

/** Every collection, for pickers and membership editors. */
export async function getCollectionOptions(): Promise<Collection[]> {
  const cached = await cachedCollections();
  if (cached) return cached;
  const supabase = await createClient();
  const { data } = await supabase.from("collections").select("*").order("title");
  return (data as Collection[] | null) ?? [];
}

/** Autocomplete sources for the product editor's Organization card. */
export async function getProductFacets(): Promise<ProductFacets> {
  const cached = await cachedFacets();
  if (cached) return cached;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("product_facets");
  if (error || !data) return EMPTY_FACETS;
  return data as ProductFacets;
}

/* -------------------------------------------------------------------------- */
/* Invalidation — call from the Server Action that wrote the row              */
/* -------------------------------------------------------------------------- */

export function revalidateLocations(): void {
  updateTag(LOCATIONS_TAG);
}

/** Tags, vendors, types or categories may have changed with a product save. */
export function revalidateFacets(): void {
  updateTag(FACETS_TAG);
}
