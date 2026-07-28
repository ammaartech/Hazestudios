import Link from "next/link";
import { ARRIVALS, CAROUSELS, LOOKBOOK, TAB_CAROUSEL } from "@/lib/shop/home-content";
import {
  getCollectionByHandle,
  getProduct,
  getProductsInCollection,
} from "@/lib/shop/queries";
import { toRailProduct, type RailProduct } from "@/lib/shop/swatches";
import { ProductRail } from "@/components/shop/product-rail";
import { TabCarousel, type CarouselTab } from "@/components/shop/tab-carousel";
import {
  Arrivals,
  Divider,
  Hero,
  Lookbook,
  Mosaic,
  SectionHeading,
  type ArrivalTag,
} from "@/components/shop/home-sections";

export const dynamic = "force-dynamic";

/**
 * Resolves one authored carousel to the products behind it.
 *
 * A missing or unpublished collection returns null rather than an empty rail:
 * the section is then skipped entirely, so the page closes up around it instead
 * of leaving a heading with nothing underneath.
 */
async function loadRail(handle: string): Promise<
  { title: string; products: RailProduct[] } | null
> {
  const collection = await getCollectionByHandle(handle);
  if (!collection) return null;

  const products = await getProductsInCollection(collection);
  if (!products.length) return null;

  return { title: collection.title, products: products.map(toRailProduct) };
}

export default async function HomePage() {
  // One pass over every section's data. They are independent reads, so they go
  // out together rather than waterfalling down the page.
  const [tabRails, carouselRails, arrivalProducts] = await Promise.all([
    Promise.all(TAB_CAROUSEL.tabs.map((tab) => loadRail(tab.handle))),
    Promise.all(CAROUSELS.map((section) => loadRail(section.handle))),
    Promise.all(ARRIVALS.frames.map((frame) => getProduct(frame.handle))),
  ]);

  // The authored label wins where given, so a tab can read "Tees" while the
  // collection behind it is called something longer; otherwise the collection
  // names its own tab.
  const tabs: CarouselTab[] = TAB_CAROUSEL.tabs.flatMap((tab, i) => {
    const rail = tabRails[i];
    return rail ? [{ label: tab.label ?? rail.title, products: rail.products }] : [];
  });

  const arrivalTags: ArrivalTag[] = arrivalProducts.flatMap((product) =>
    product
      ? [
          {
            handle: product.handle || product.id,
            title: product.title,
            price: product.price,
            compareAt: product.compare_at_price,
          },
        ]
      : []
  );

  const hasCarousels = carouselRails.some(Boolean);

  return (
    <>
      <Hero />

      <TabCarousel
        heading={TAB_CAROUSEL.heading}
        subheading={TAB_CAROUSEL.subheading}
        tabs={tabs}
      />

      <SectionHeading>{LOOKBOOK.heading}</SectionHeading>
      <Lookbook />

      <Divider />

      <SectionHeading>{ARRIVALS.heading}</SectionHeading>
      <Arrivals tags={arrivalTags} />

      {hasCarousels && (
        <div className="mt-20 flex flex-col gap-20 md:mt-28 md:gap-28">
          {CAROUSELS.map((section, i) => {
            const rail = carouselRails[i];
            if (!rail) return null;
            const heading = section.heading ?? rail.title;

            return (
              <section key={section.handle} aria-labelledby={`rail-${section.handle}`}>
                <div className="px-4 text-center md:px-8">
                  <h2
                    id={`rail-${section.handle}`}
                    className="display text-[clamp(1.75rem,4vw,2.75rem)]"
                  >
                    {heading}
                  </h2>
                  {section.subheading && (
                    <p className="mt-3 text-sm text-[var(--shop-mute)]">
                      {section.subheading}
                    </p>
                  )}
                </div>

                <div className="mt-10">
                  <ProductRail products={rail.products} label={heading} />
                </div>

                {section.cta && (
                  <div className="mt-10 text-center">
                    <Link
                      href={`/collections/${section.handle}`}
                      className="meta inline-block cursor-pointer border-b border-[var(--shop-ink)] pb-1 transition-opacity duration-200 hover:opacity-60"
                    >
                      {section.cta}
                    </Link>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Mosaic />

      {/* A fresh install with no catalogue: the editorial above still renders,
          but nothing is buyable, so say so rather than leaving empty rails. */}
      {!tabs.length && !hasCarousels && (
        <section className="px-4 py-24 text-center md:px-8">
          <h2 className="display text-[clamp(1.5rem,4vw,2.5rem)]">
            Nothing to shop yet
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm text-[var(--shop-mute)]">
            The home page carousels point at collections that are missing or
            empty. Publish them in the admin, or change the handles in{" "}
            <code className="text-[var(--shop-charcoal)]">
              src/lib/shop/home-content.ts
            </code>
            .
          </p>
          <Link
            href="/admin/products/collections"
            className="mt-8 inline-flex min-h-12 cursor-pointer items-center rounded-full bg-[var(--shop-ink)] px-8 text-sm font-medium text-[var(--shop-canvas)] transition-opacity duration-200 hover:opacity-85"
          >
            Manage collections
          </Link>
        </section>
      )}
    </>
  );
}
