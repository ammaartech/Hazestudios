import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/shop/product-card";
import {
  getCatalogHandles,
  getCollectionByHandle,
  getProductsInCollection,
} from "@/lib/shop/queries";

/**
 * Prerender every published collection.
 *
 * There are a few dozen of them and they are the storefront's primary
 * navigation, so the whole set is worth building ahead of time. A collection
 * published after the build still resolves — `dynamicParams` is on by default —
 * it just pays for its own first render.
 */
export async function generateStaticParams() {
  const { collections } = await getCatalogHandles();
  // Cache Components rejects an empty array, and a build should not fail
  // because Supabase happened to be unreachable for a moment. One unknown
  // handle prerenders as the 404 it would be anyway.
  return collections.length
    ? collections.map((handle) => ({ handle }))
    : [{ handle: "__none__" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const collection = await getCollectionByHandle(handle);
  if (!collection) return { title: "Collection not found" };

  // The SEO fields override, and fall back to the on-page content — the same
  // resolution the admin's preview shows, so what is previewed is what ships.
  const title = collection.seo_title.trim() || collection.title;
  const description =
    collection.seo_description.trim() || collection.description.trim();

  return {
    title,
    description: description || undefined,
    openGraph: {
      title,
      description: description || undefined,
      images: collection.image_url ? [collection.image_url] : undefined,
    },
  };
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const collection = await getCollectionByHandle(handle);
  if (!collection) notFound();

  const products = await getProductsInCollection(collection);

  return (
    <>
      {/* Editorial header — full-bleed when the collection has artwork, plain
          type when it doesn't, so an image-less collection still reads well. */}
      {collection.image_url ? (
        <section className="relative isolate flex min-h-[46dvh] items-end overflow-hidden bg-[var(--shop-cloud)] md:min-h-[56dvh]">
          <Image
            src={collection.image_url}
            alt=""
            aria-hidden
            fill
            /* The one image on this page that is unambiguously the LCP — a
               full-bleed banner above everything else — so it earns a real
               <link rel=preload> rather than just an eager fetch. */
            preload
            sizes="100vw"
            className="object-cover"
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
            aria-hidden
          />
          {/* On load rather than on scroll: the header is the first thing on
              screen, and its artwork is the page's largest paint. Only the type
              animates — see the hero note in globals.css. */}
          <div className="relative w-full px-4 pb-10 md:px-8 md:pb-14">
            <h1
              className="display max-w-[16ch] text-[clamp(2.5rem,8vw,6.5rem)] text-white"
              data-hero-in
            >
              {collection.title}
            </h1>
            {collection.description && (
              <p
                className="mt-5 max-w-lg text-base leading-relaxed text-white/85"
                data-hero-in
                style={{ ["--reveal-index" as string]: 1 }}
              >
                {collection.description}
              </p>
            )}
          </div>
        </section>
      ) : (
        <section className="border-b border-[var(--shop-hairline-soft)] px-4 pb-10 pt-16 md:px-8 md:pt-24">
          <h1 className="display text-[clamp(2.5rem,8vw,6.5rem)]" data-hero-in>
            {collection.title}
          </h1>
          {collection.description && (
            <p
              className="mt-5 max-w-lg text-base leading-relaxed text-[var(--shop-mute)]"
              data-hero-in
              style={{ ["--reveal-index" as string]: 1 }}
            >
              {collection.description}
            </p>
          )}
        </section>
      )}

      <section className="px-4 pt-10 md:px-8 md:pt-14">
        <p className="meta text-[var(--shop-mute)]">
          {products.length} {products.length === 1 ? "piece" : "pieces"}
        </p>

        {products.length ? (
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4">
            {products.map((product, i) => (
              /* The cascade is per row, not per grid. Passing the running index
                 into a collection of sixty pieces would have the bottom row
                 waiting on everything above it, long after the shopper has
                 scrolled past. The widest arrangement is four columns, so the
                 index wraps there and every row opens left to right. */
              <ProductCard
                key={product.id}
                product={product}
                eager={i < 4}
                revealIndex={i % 4}
              />
            ))}
          </div>
        ) : (
          <div className="py-24 text-center">
            <p className="display text-3xl">Nothing in this collection</p>
            <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--shop-mute)]">
              Pieces assigned to {collection.title} will appear here.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
