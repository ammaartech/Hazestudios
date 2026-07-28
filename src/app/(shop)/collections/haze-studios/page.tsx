import type { Metadata } from "next";
import {
  HAZE_ARRIVALS,
  HAZE_FEATURED,
  HAZE_HERO,
  HAZE_LOOKBOOK,
  HAZE_TABS,
} from "@/lib/shop/haze-studios-content";
import type { FeaturedCollection as FeaturedConfig } from "@/lib/shop/home-content";
import {
  getCollectionByHandle,
  getProduct,
  getProductsInCollection,
} from "@/lib/shop/queries";
import { toRailProduct, type RailProduct } from "@/lib/shop/swatches";
import { FeaturedCollection } from "@/components/shop/featured-collection";
import { Hero, SectionIntro } from "@/components/shop/home-sections";
import {
  Arrivals,
  Lookbook,
  Tiles,
  type ArrivalTag,
} from "@/components/shop/haze-studios-sections";
import { TabCarousel, type CarouselTab } from "@/components/shop/tab-carousel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Haze Studios",
  description:
    "Haze Studios — campus fits, hoodies, boxy tees, waffle tees and denim. Feels expensive. Looks good. Priced Fair.",
};

/**
 * The Haze Studios landing page — the menswear side of Fogstores.
 *
 * A static segment, so it takes precedence over `collections/[handle]`: this
 * handle gets an authored campaign page instead of the standard product grid,
 * while every other collection still falls through to the generic route.
 */
interface ResolvedBlock {
  config: FeaturedConfig;
  heading: string;
  products: RailProduct[];
}

/**
 * Resolves one authored collection block to the products behind it. A missing
 * or unpublished collection returns null rather than an empty block, so the
 * page closes up around it instead of leaving a heading with nothing under it.
 */
async function loadBlock(config: FeaturedConfig): Promise<ResolvedBlock | null> {
  const collection = await getCollectionByHandle(config.handle);
  if (!collection) return null;

  const products = await getProductsInCollection(collection);
  if (!products.length) return null;

  return {
    config,
    heading: config.heading ?? collection.title,
    products: products.slice(0, config.limit).map(toRailProduct),
  };
}

/** The same, for a tab — which keeps the collection's own title as a fallback. */
async function loadTab(
  handle: string,
  limit: number
): Promise<{ title: string; products: RailProduct[] } | null> {
  const collection = await getCollectionByHandle(handle);
  if (!collection) return null;

  const products = await getProductsInCollection(collection);
  if (!products.length) return null;

  return {
    title: collection.title,
    products: products.slice(0, limit).map(toRailProduct),
  };
}

export default async function HazeStudiosPage() {
  // Independent reads, so they go out together rather than waterfalling.
  const [tabRails, featuredBlocks, arrivalProducts] = await Promise.all([
    Promise.all(HAZE_TABS.tabs.map((tab) => loadTab(tab.handle, HAZE_TABS.limit))),
    Promise.all(HAZE_FEATURED.map(loadBlock)),
    Promise.all(HAZE_ARRIVALS.frames.map((frame) => getProduct(frame.handle))),
  ]);

  // The authored label wins where given, so a tab can read "Tees" while the
  // collection behind it is called something longer; otherwise the collection
  // names its own tab.
  const tabs: CarouselTab[] = HAZE_TABS.tabs.flatMap((tab, i) => {
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
            image: product.images[0]?.url ?? null,
          },
        ]
      : []
  );

  return (
    <>
      <Hero content={HAZE_HERO} overlay caps />

      <TabCarousel
        heading={HAZE_TABS.heading}
        subheading={HAZE_TABS.subheading}
        tabs={tabs}
      />

      <SectionIntro eyebrow={HAZE_LOOKBOOK.eyebrow} />
      <Lookbook />

      <SectionIntro eyebrow={HAZE_ARRIVALS.eyebrow} />
      <Arrivals tags={arrivalTags} />

      {featuredBlocks.map(
        (block) =>
          block && (
            <FeaturedCollection
              key={block.config.handle}
              config={block.config}
              heading={block.heading}
              products={block.products}
            />
          )
      )}

      <Tiles />
    </>
  );
}
