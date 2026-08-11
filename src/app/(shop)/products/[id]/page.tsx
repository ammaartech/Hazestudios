import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/shop/product-card";
import { ProductGallery } from "@/components/shop/product-gallery";
import { VariantPicker } from "@/components/shop/variant-picker";
import { ProductViewTracker } from "@/components/shop/product-view-tracker";
import { SizeGuide } from "@/components/shop/size-guide";
import {
  getCatalogHandles,
  getLatestProducts,
  getProduct,
} from "@/lib/shop/queries";
import {
  hasSizeChartData,
  parseSizeChart,
  populatedMeasurements,
  populatedRows,
} from "@/lib/size-chart";

/**
 * Prerender the whole catalogue.
 *
 * A PDP is the most cacheable page in the store — the same hoodie, the same
 * price, the same photographs for everybody — and it is also the page a drop
 * points a thousand people at within the same minute. Building all of them
 * ahead of time turns that spike into a static file read: no React render, no
 * database round trip, nothing to contend over.
 *
 * A product added after the build still works. `dynamicParams` defaults to
 * true, so an unknown handle renders on demand and is cached from then on; the
 * only difference is that the first shopper to open it pays for the render.
 */
export async function generateStaticParams() {
  const { products } = await getCatalogHandles();
  // Cache Components rejects an empty array, and a build should not fail
  // because Supabase happened to be unreachable for a moment. One unknown
  // handle prerenders as the 404 it would be anyway.
  return products.length
    ? products.map((id) => ({ id }))
    : [{ id: "__none__" }];
}

/*
 * `getProduct` is called twice below, once for metadata and once for the body.
 * That is deliberate and free: it is wrapped in React `cache`, so the second
 * call inside the same render pass returns the first call's promise rather than
 * reaching Supabase again.
 */

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

  /*
   * The rail below used to be `getRelatedProducts(product.id, 4)` — "the four
   * newest products that are not this one" — which had to wait for `getProduct`
   * to learn the id to exclude, and was cached *per excluded id*. That is one
   * sequential round trip per PDP and one cache entry per product in the
   * catalogue, to hold what is very nearly the same four items every time.
   *
   * Asking for five and dropping this one gives an identical rail from a single
   * entry the whole catalogue shares, and no longer depends on the product, so
   * the two reads go out together.
   */
  const [product, latest] = await Promise.all([
    getProduct(id),
    getLatestProducts(5),
  ]);
  if (!product) notFound();

  const related = latest.filter((p) => p.id !== product.id).slice(0, 4);

  // Parsed and pruned here, on the server, so the client component receives
  // only columns and rows that actually carry values. `null` means there is
  // nothing worth showing — the toggle may be on over an empty grid.
  const sizeChart = (() => {
    if (!product.size_chart_enabled) return null;
    const chart = parseSizeChart(product.size_chart);
    if (!hasSizeChartData(chart)) return null;
    return {
      chart,
      measurements: populatedMeasurements(chart),
      rows: populatedRows(chart),
    };
  })();

  return (
    <>
      <ProductViewTracker productId={product.id} productTitle={product.title} />
      {/*
        Capped, and centred once the cap bites. Left uncapped the two columns
        just kept growing: on a wide monitor the photography column resolved to
        around a thousand pixels, which at 4:5 is a picture taller than the
        screen — the shopper landed on a crop of fabric with the size buttons
        and the price somewhere below the fold.
      */}
      <article className="mx-auto max-w-[88rem] md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start md:gap-12 lg:gap-20">
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

          {/* Left, with the size buttons it belongs to. Centred it read as a
              separate block rather than as help for the choice above it. */}
          {sizeChart && (
            <div className="mt-4 flex justify-start">
              <SizeGuide
                chart={sizeChart.chart}
                measurements={sizeChart.measurements}
                rows={sizeChart.rows}
              />
            </div>
          )}

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
              More from Fogstores
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
