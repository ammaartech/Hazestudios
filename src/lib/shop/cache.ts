import { updateTag } from "next/cache";

/**
 * The storefront's cache vocabulary: the tag names, and the invalidation
 * helpers that write actions call after a mutation.
 *
 * The caching itself lives with the queries in `queries.ts`, as `use cache`
 * directives with their own `cacheLife`/`cacheTag` calls. That is deliberate,
 * and the Next docs ask for it explicitly — a shared `withCache()` wrapper
 * hides how long a given read lives and what invalidates it behind one more
 * indirection. What belongs here is the part that genuinely is shared: the tag
 * strings, so a producer and a consumer cannot drift apart on a typo.
 *
 * The lifetime for all of them is the `catalog` profile defined in
 * `next.config.ts`.
 */

/** Everything catalogue-shaped. The blunt instrument, for bulk edits. */
export const CATALOG_TAG = "catalog";
/** Collection rows and membership — the header and footer navigation. */
export const COLLECTIONS_TAG = "collections";
/** `shop_settings`, i.e. the store name in the header and footer. */
export const SETTINGS_TAG = "shop-settings";
/** The event waitlist count behind the "seats left" line on /waitlist. */
export const WAITLIST_TAG = "waitlist";

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
 * say — must use `revalidateTag(tag, 'catalog')` instead.
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

/**
 * Someone joined the event waitlist, so the "seats left" line on /waitlist is
 * one behind. Called from the sign-up action, which — per the note above — is
 * the only kind of caller `updateTag` permits.
 */
export function revalidateWaitlist(): void {
  updateTag(WAITLIST_TAG);
}
