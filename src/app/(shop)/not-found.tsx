import Link from "next/link";

/**
 * The storefront's 404, inside the storefront chrome.
 *
 * Without this file a `notFound()` from any shop route falls through to the
 * root not-found, which renders outside this layout — a bare page with no nav,
 * no way back into the catalogue, and none of the shop's typography. A dead URL
 * is a normal thing for a store (a sold-through drop, a stale link in someone's
 * bookmarks) and it should still look like the shop.
 *
 * Deliberately static: no data, nothing to await, so it prerenders.
 */
export default function ShopNotFound() {
  return (
    <section className="flex min-h-[60dvh] flex-col items-center justify-center px-4 py-24 text-center md:px-8">
      <p className="meta text-(--shop-mute)">404</p>
      <h1 className="display mt-4 text-[clamp(2rem,6vw,4rem)]">
        This page has moved on
      </h1>
      <p className="mt-4 max-w-sm text-sm leading-relaxed text-(--shop-mute)">
        The piece you were looking for may have sold out or been renamed.
      </p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
        <Link
          href="/"
          className="meta cursor-pointer border-b border-(--shop-ink) pb-1 transition-opacity duration-200 hover:opacity-60"
        >
          Back to the shop
        </Link>
        <Link
          href="/search"
          className="meta cursor-pointer border-b border-(--shop-ink) pb-1 transition-opacity duration-200 hover:opacity-60"
        >
          Search
        </Link>
      </div>
    </section>
  );
}
