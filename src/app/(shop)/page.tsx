import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProductCard } from "@/components/shop/product-card";
import { getCollections, getLatestProducts, getProductsInCollection } from "@/lib/shop/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const collections = await getCollections();
  const [hero, ...rest] = collections;

  // The lead collection carries the hero and the first grid; the remainder
  // become editorial tiles. Falls back to latest products if nothing is set up.
  const heroProducts = hero ? await getProductsInCollection(hero) : [];
  const fallback = heroProducts.length ? [] : await getLatestProducts(8);
  const featured = (heroProducts.length ? heroProducts : fallback).slice(0, 8);

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Full-bleed campaign hero                                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="relative isolate flex min-h-[78vh] items-end overflow-hidden bg-[var(--shop-cloud)] md:min-h-[88vh]">
        {hero?.image_url && (
          <Image
            src={hero.image_url}
            alt=""
            aria-hidden
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        )}
        {/* Scrim: the display type sits on photography, so it needs a guaranteed
            contrast floor rather than relying on whatever the image happens to be. */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent"
          aria-hidden
        />

        <div className="relative w-full px-4 pb-12 md:px-8 md:pb-16">
          {hero && (
            <p className="meta mb-5 text-white/80">
              {hero.type === "smart" ? "Curated" : "New release"}
            </p>
          )}
          <h1 className="display max-w-[14ch] text-[clamp(3rem,11vw,9rem)] text-white">
            {hero?.title ?? "Hazestudios"}
          </h1>
          {hero?.description && (
            <p className="mt-6 max-w-md text-base leading-relaxed text-white/85">
              {hero.description}
            </p>
          )}
          {hero && (
            <Link
              href={`/collections/${hero.handle}`}
              className="mt-8 inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-white px-8 text-sm font-medium text-[var(--shop-ink)] transition-colors duration-200 hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              Shop the drop
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Featured products                                                   */}
      {/* ------------------------------------------------------------------ */}
      {featured.length > 0 && (
        <section className="px-4 pt-16 md:px-8 md:pt-24">
          <div className="flex items-end justify-between gap-6">
            <h2 className="display text-[clamp(1.75rem,4vw,3rem)]">
              {hero?.title ?? "Latest"}
            </h2>
            {hero && (
              <Link
                href={`/collections/${hero.handle}`}
                className="meta shrink-0 cursor-pointer border-b border-[var(--shop-ink)] pb-1 transition-opacity duration-200 hover:opacity-60"
              >
                View all
              </Link>
            )}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4">
            {featured.map((product, i) => (
              <ProductCard key={product.id} product={product} priority={i < 4} />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Collection tiles — lookbook framing                                 */}
      {/* ------------------------------------------------------------------ */}
      {rest.length > 0 && (
        <section className="mt-24 md:mt-32">
          <h2 className="sr-only">Collections</h2>
          <div className="grid gap-px bg-[var(--shop-hairline-soft)] md:grid-cols-2">
            {rest.map((collection) => (
              <Link
                key={collection.id}
                href={`/collections/${collection.handle}`}
                className="group relative isolate flex min-h-[60vh] items-end overflow-hidden bg-[var(--shop-cloud)] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white"
              >
                {collection.image_url && (
                  <Image
                    src={collection.image_url}
                    alt=""
                    aria-hidden
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                  />
                )}
                <div
                  className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent"
                  aria-hidden
                />
                <div className="relative w-full p-6 md:p-10">
                  <h3 className="display text-[clamp(2rem,5vw,4rem)] text-white">
                    {collection.title}
                  </h3>
                  {collection.description && (
                    <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/80">
                      {collection.description}
                    </p>
                  )}
                  <span className="meta mt-5 inline-flex items-center gap-2 text-white">
                    Explore
                    <ArrowRight
                      className="size-3.5 transition-transform duration-200 group-hover:translate-x-1"
                      aria-hidden
                    />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Empty state — a fresh install with no catalog yet. */}
      {!collections.length && !featured.length && (
        <section className="px-4 py-32 text-center md:px-8">
          <h1 className="display text-[clamp(2rem,6vw,4rem)]">Nothing here yet</h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-[var(--shop-mute)]">
            No active products or collections were returned. Add them in the admin,
            and make sure the public read policies migration has been applied.
          </p>
          <Link
            href="/admin/products"
            className="mt-8 inline-flex min-h-12 cursor-pointer items-center rounded-full bg-[var(--shop-ink)] px-8 text-sm font-medium text-[var(--shop-canvas)] transition-opacity duration-200 hover:opacity-85"
          >
            Go to admin
          </Link>
        </section>
      )}
    </>
  );
}
