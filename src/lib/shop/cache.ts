import { unstable_cache, updateTag } from "next/cache";

/**
 * The storefront's catalogue cache: tags, lifetime, and the single wrapper
 * every public read goes through.
 *
 * Why this is one file
 * --------------------
 * `unstable_cache` is soft-deprecated in Next 16 in favour of the `use cache`
 * directive, and the migration guide is explicit that it "keeps working as a
 * separate layer" in the meantime. It is used here on purpose rather than out
 * of inertia, for one reason that decides it: `use cache` stores entries
 * **in-memory, per instance**, so on serverless "cache entries typically don't
 * persist across requests" (see `use-cache.md`, Runtime caching considerations).
 * A thousand concurrent shoppers land on a thousand cold instances and we are
 * back to a thousand round trips — precisely the problem being fixed. The
 * `unstable_cache` store persists across instances *and* deployments.
 *
 * The way out is `cacheComponents: true` plus a prerendered shell, which is a
 * whole-app migration (41 admin pages read `cookies()` outside Suspense). This
 * module is the seam that keeps that migration cheap: swapping to `use cache`
 * means rewriting `cachedCatalogRead` and nothing else, because the tag names
 * and lifetimes below map one-for-one onto `cacheTag` and `cacheLife`.
 */

/** Everything catalogue-shaped. The blunt instrument, for bulk edits. */
export const CATALOG_TAG = "catalog";
/** Collection rows and membership — the header and footer navigation. */
export const COLLECTIONS_TAG = "collections";
/** `shop_settings`, i.e. the store name in the header and footer. */
export const SETTINGS_TAG = "shop-settings";

/**
 * A single product, by id *and* by handle.
 *
 * Both are minted because a PDP is reachable by either (`getProduct` accepts
 * whichever the URL carries) and a mutation only reliably knows the id. Tagging
 * an entry with both means an edit can invalidate it without first working out
 * which spelling a given visitor's cache entry was keyed under.
 */
export function productTag(idOrHandle: string): string {
  return `product:${idOrHandle}`;
}

/**
 * Ceiling on how stale the catalogue can go when nothing invalidates it.
 *
 * Admin writes invalidate by tag, so this is not the freshness mechanism — it
 * is the backstop for changes that arrive without passing through a Server
 * Action (a direct SQL edit, a Supabase dashboard tweak). Sixty seconds is
 * short enough that nobody is misled for long, and at drop traffic it is
 * indistinguishable from infinite: a thousand concurrent viewers still collapse
 * to one query.
 */
export const CATALOG_TTL = 60;

/**
 * Wraps a catalogue read so that N concurrent callers cost one round trip.
 *
 * `keyParts` disambiguates functions whose arguments alone would collide —
 * `getLatestProducts(4)` and `getRelatedProducts(id, 4)` must not share an
 * entry. The arguments themselves are folded into the key automatically, so
 * only the name needs to be passed.
 *
 * The wrapped function must not touch `cookies()`, `headers()` or any other
 * request API; that is what `createPublicClient` is for.
 */
export function cachedCatalogRead<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
  tags: string[] = [CATALOG_TAG]
): (...args: A) => Promise<R> {
  return unstable_cache(fn, [name], {
    tags,
    revalidate: CATALOG_TTL,
  });
}

/**
 * Drops the cached catalogue after a write.
 *
 * Call this from every Server Action that changes something a shopper can see:
 * product fields, images, variants, stock, collection membership. Passing the
 * ids and handles that changed keeps the blast radius small; the broad
 * `CATALOG_TAG` is always cleared as well because a single product edit can
 * still move it in and out of a smart collection, a rail, or the search index.
 *
 * `updateTag`, not `revalidateTag`, and the distinction matters here. In Next 16
 * `revalidateTag` is stale-while-revalidate — it requires a cache profile and
 * lets the *next* request keep serving the old value while a refresh happens
 * behind it. That is wrong for an operator: someone who has just corrected a
 * price and clicked through to the storefront to check it would be shown the
 * mistake they thought they had fixed. `updateTag` expires the entry outright,
 * so the next read blocks on fresh data. The cost is one slow request after a
 * save, paid by staff rather than by shoppers.
 *
 * The trade-off of that choice: `updateTag` may only be called from a Server
 * Action and throws anywhere else. Every caller today is one. A webhook or
 * route handler that starts mutating the catalogue — a Qikink stock callback,
 * say — must use `revalidateTag(tag, 'max')` instead.
 */
export function revalidateCatalog(
  keys: { ids?: (string | null | undefined)[]; handles?: (string | null | undefined)[] } = {}
): void {
  updateTag(CATALOG_TAG);

  for (const key of [...(keys.ids ?? []), ...(keys.handles ?? [])]) {
    if (key) updateTag(productTag(key));
  }
}

/** Navigation changed: a collection was created, renamed, or (un)published. */
export function revalidateCollections(): void {
  updateTag(COLLECTIONS_TAG);
  updateTag(CATALOG_TAG);
}

/** Store-level settings changed. */
export function revalidateSettings(): void {
  updateTag(SETTINGS_TAG);
}
