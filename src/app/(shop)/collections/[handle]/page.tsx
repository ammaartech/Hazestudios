import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/shop/product-card";
import { getCollectionByHandle, getProductsInCollection } from "@/lib/shop/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const collection = await getCollectionByHandle(handle);
  if (!collection) return { title: "Collection not found" };
  return {
    title: collection.title,
    description: collection.description || undefined,
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
        <section className="relative isolate flex min-h-[46vh] items-end overflow-hidden bg-[var(--shop-cloud)] md:min-h-[56vh]">
          <Image
            src={collection.image_url}
            alt=""
            aria-hidden
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
            aria-hidden
          />
          <div className="relative w-full px-4 pb-10 md:px-8 md:pb-14">
            <h1 className="display max-w-[16ch] text-[clamp(2.5rem,8vw,6.5rem)] text-white">
              {collection.title}
            </h1>
            {collection.description && (
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/85">
                {collection.description}
              </p>
            )}
          </div>
        </section>
      ) : (
        <section className="border-b border-[var(--shop-hairline-soft)] px-4 pb-10 pt-16 md:px-8 md:pt-24">
          <h1 className="display text-[clamp(2.5rem,8vw,6.5rem)]">
            {collection.title}
          </h1>
          {collection.description && (
            <p className="mt-5 max-w-lg text-base leading-relaxed text-[var(--shop-mute)]">
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
              <ProductCard key={product.id} product={product} priority={i < 4} />
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
