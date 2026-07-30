import Link from "next/link";
import {
  FEATURED_BOTTOM,
  FEATURED_TOP,
  MOST_TRENDING_EYEBROW,
  REEL,
  type FeaturedCollection as FeaturedConfig,
} from "@/lib/shop/home-content";
import {
  getCollectionByHandle,
  getProduct,
  getProductsInCollection,
} from "@/lib/shop/queries";
import { toRailProduct, type RailProduct } from "@/lib/shop/swatches";
import { FeaturedCollection } from "@/components/shop/featured-collection";
import { ShoppableReel, type ReelItem } from "@/components/shop/shoppable-reel";
import {
  BrandMarquee,
  EditorialBanner,
  Hero,
  SectionIntro,
  ShopTheLook,
  ShortcutRow,
} from "@/components/shop/home-sections";

interface ResolvedBlock {
  config: FeaturedConfig;
  heading: string;
  products: RailProduct[];
}

/**
 * Resolves one authored collection block to the products behind it.
 *
 * A missing or unpublished collection returns null rather than an empty block:
 * the section is then skipped entirely, so the page closes up around it instead
 * of leaving a heading with nothing underneath.
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

export default async function HomePage() {
  // One pass over every section's data. They are independent reads, so they go
  // out together rather than waterfalling down the page.
  const [topBlocks, bottomBlocks, reelProducts] = await Promise.all([
    Promise.all(FEATURED_TOP.map(loadBlock)),
    Promise.all(FEATURED_BOTTOM.map(loadBlock)),
    Promise.all(REEL.cards.map((card) => getProduct(card.handle))),
  ]);

  // A reel card whose product no longer resolves is dropped rather than shown
  // with a blank tag. Where no customer clip has been uploaded the card falls
  // back to the product's own photography, so the row stays full while the
  // user-generated media is being cut.
  const reelItems: ReelItem[] = REEL.cards.flatMap((card, i) => {
    const product = reelProducts[i];
    if (!product) return [];

    const [primary] = product.images;
    const media = card.media ?? primary?.url;
    if (!media) return [];

    return [
      {
        handle: product.handle || product.id,
        title: product.title,
        price: product.price,
        compareAt: product.compare_at_price,
        media,
        video: card.video ?? false,
        // The chip identifies which product a customer's clip is tagged to. On
        // a card still falling back to the product's own shot it would be that
        // same photograph twice over, so it is left off until the clip lands.
        thumb: card.media ? (primary?.url ?? null) : null,
        caption: card.caption,
      },
    ];
  });

  const blocks = [...topBlocks, ...bottomBlocks].filter(Boolean);

  return (
    <>
      <ShortcutRow />
      <Hero />

      <SectionIntro eyebrow={MOST_TRENDING_EYEBROW} />
      <ShopTheLook />

      {topBlocks.map(
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

      <ShoppableReel items={reelItems} />

      <BrandMarquee />
      <EditorialBanner />

      {bottomBlocks.map(
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

      {/* A fresh install with no catalogue: the editorial above still renders,
          but nothing is buyable, so say so rather than leaving empty rails. */}
      {!blocks.length && !reelItems.length && (
        <section className="px-4 py-24 text-center md:px-8">
          <h2 className="display text-[clamp(1.5rem,4vw,2.5rem)]">
            Nothing to shop yet
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm text-[var(--shop-mute)]">
            The home page sections point at collections that are missing or
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
