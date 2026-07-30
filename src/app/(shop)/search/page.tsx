import { Suspense } from "react";
import Link from "next/link";
import { ProductCard } from "@/components/shop/product-card";
import { searchProducts } from "@/lib/shop/queries";
import { QUICK_LINKS } from "@/lib/shop/home-content";
import { SearchField } from "./search-field";

export const metadata = { title: "Search" };

/**
 * Product search — the destination behind the header's magnifier.
 *
 * A plain GET form, so a search is a URL: shareable, bookmarkable, and it works
 * before hydration. The results are a grid rather than a rail because a result
 * set has no curated order to scroll through.
 *
 * The page splits along the one line that matters under Partial Prerendering:
 * the heading, the search box and the help links are the same for everybody and
 * ship as static HTML, while the results — which depend on `?q=` and therefore
 * on the request — stream in behind a boundary. A shopper on a slow connection
 * gets a usable search box in the first paint instead of after a database round
 * trip.
 */
export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  return (
    <section className="px-4 pb-24 pt-16 md:px-8 md:pt-24">
      <h1 className="display text-center text-[clamp(1.75rem,4vw,2.75rem)]">
        Search
      </h1>

      <SearchField />

      {/* No fallback: an empty search and an unresolved one look identical, and
          a spinner under the box would only advertise the wait. */}
      <Suspense fallback={<HelpLinks />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function Results({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const term = q.trim();
  const products = term ? await searchProducts(term) : [];

  return (
    <>
      {term && (
        <p role="status" className="mt-6 text-center text-sm text-(--shop-mute)">
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

      {!products.length && <HelpLinks />}
    </>
  );
}

/**
 * An empty search is the one moment a shopper is definitely looking for
 * something and has not found it, so the help links belong here.
 */
function HelpLinks() {
  return (
    <nav aria-label="Help" className="mt-16 text-center">
      <ul className="flex flex-wrap justify-center gap-x-6 gap-y-3">
        {QUICK_LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="cursor-pointer text-sm text-(--shop-mute) transition-colors duration-200 hover:text-(--shop-ink)"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
