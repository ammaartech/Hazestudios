import { Search } from "lucide-react";
import { ProductCard } from "@/components/shop/product-card";
import { searchProducts } from "@/lib/shop/queries";
import { QUICK_LINKS } from "@/lib/shop/home-content";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = { title: "Search" };

/**
 * Product search — the destination behind the header's magnifier.
 *
 * A plain GET form, so a search is a URL: shareable, bookmarkable, and it works
 * before hydration. The results are a grid rather than a rail because a result
 * set has no curated order to scroll through.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const term = q.trim();
  const products = term ? await searchProducts(term) : [];

  return (
    <section className="px-4 pb-24 pt-16 md:px-8 md:pt-24">
      <h1 className="display text-center text-[clamp(1.75rem,4vw,2.75rem)]">
        Search
      </h1>

      <form action="/search" method="get" className="relative mx-auto mt-8 max-w-lg">
        <label htmlFor="q" className="sr-only">
          Search for products on our site
        </label>
        <Search
          className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-[var(--shop-stone)]"
          aria-hidden
        />
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={term}
          autoFocus
          placeholder="Search for products on our site"
          className="h-14 w-full rounded-full border border-[var(--shop-hairline)] bg-transparent pl-12 pr-6 text-sm text-[var(--shop-ink)] placeholder:text-[var(--shop-stone)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shop-ink)]"
        />
      </form>

      {term && (
        <p role="status" className="mt-6 text-center text-sm text-[var(--shop-mute)]">
          {products.length
            ? `${products.length} result${products.length === 1 ? "" : "s"} for “${term}”`
            : `No results for “${term}”.`}
        </p>
      )}

      {products.length > 0 && (
        <div className="mx-auto mt-12 grid max-w-7xl grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4">
          {products.map((product, i) => (
            <ProductCard key={product.id} product={product} eager={i < 4} />
          ))}
        </div>
      )}

      {/* An empty search is the one moment a shopper is definitely looking for
          something and has not found it, so the help links belong here. */}
      {!products.length && (
        <nav aria-label="Help" className="mt-16 text-center">
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-3">
            {QUICK_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="cursor-pointer text-sm text-[var(--shop-mute)] transition-colors duration-200 hover:text-[var(--shop-ink)]"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}
