import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/shop/product-card";
import { ProductGallery } from "@/components/shop/product-gallery";
import { VariantPicker } from "@/components/shop/variant-picker";
import { getProduct, getRelatedProducts } from "@/lib/shop/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return { title: "Product not found" };
  return {
    title: product.seo_title || product.title,
    description:
      product.seo_description ||
      product.description_html.replace(/<[^>]+>/g, "").slice(0, 160),
    openGraph: product.images[0]
      ? { images: [{ url: product.images[0].url }] }
      : undefined,
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();

  const related = await getRelatedProducts(product.id, 4);

  return (
    <>
      <article className="md:grid md:grid-cols-[1.15fr_1fr] md:items-start md:gap-12 lg:gap-20">
        {/* Photography runs to the edge on mobile, and is sticky-free on desktop
            so long descriptions scroll against a stable image column. */}
        <div className="md:pl-8">
          <ProductGallery images={product.images} title={product.title} />
        </div>

        <div className="px-4 pt-8 md:sticky md:top-24 md:px-0 md:pr-8 md:pt-12">
          {product.vendor && (
            <p className="meta text-[var(--shop-mute)]">{product.vendor}</p>
          )}
          <h1 className="display mt-3 text-[clamp(2rem,5vw,3.5rem)]">
            {product.title}
          </h1>
          {product.product_type && (
            <p className="mt-2 text-sm text-[var(--shop-mute)]">
              {product.product_type}
            </p>
          )}

          <div className="mt-8">
            <VariantPicker product={product} />
          </div>

          {product.description_html && (
            <div className="mt-12 border-t border-[var(--shop-hairline-soft)] pt-8">
              <h2 className="meta text-[var(--shop-mute)]">Details</h2>
              {/*
                description_html is authored by staff in the admin's TipTap
                editor, not by customers, so this is trusted first-party content
                — the same trust boundary the admin product page already assumes.
              */}
              <div
                className="mt-4 flex flex-col gap-4 text-sm leading-relaxed text-[var(--shop-charcoal)] [&_a]:underline [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-medium"
                dangerouslySetInnerHTML={{ __html: product.description_html }}
              />
            </div>
          )}

          {product.sku && (
            <p className="mt-8 text-xs text-[var(--shop-stone)]">
              SKU {product.sku}
            </p>
          )}
        </div>
      </article>

      {related.length > 0 && (
        <section className="mt-28 px-4 md:mt-36 md:px-8">
          <div className="flex items-end justify-between gap-6">
            <h2 className="display text-[clamp(1.5rem,3.5vw,2.5rem)]">
              More from Hazestudios
            </h2>
            <Link
              href="/"
              className="meta shrink-0 cursor-pointer border-b border-[var(--shop-ink)] pb-1 transition-opacity duration-200 hover:opacity-60"
            >
              View all
            </Link>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4 md:gap-x-6">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
