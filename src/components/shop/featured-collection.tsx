import Link from "next/link";
import type { FeaturedCollection as FeaturedConfig } from "@/lib/shop/home-content";
import type { RailProduct } from "@/lib/shop/swatches";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./home-sections";
import { RailCard } from "./rail-card";

/**
 * A merchandised collection block: a heading, a row of four products, and a way
 * through to the rest of the collection.
 *
 * Two arrangements, both from the theme. The centred one leads with the
 * campaign — eyebrow, heading, then the products, with the call to action
 * underneath as the closing gesture. The left-aligned one is a shelf: the
 * heading and its call to action share a line above the row, so several can
 * stack down the page without each one demanding a full beat of attention.
 *
 * On a phone the four columns become a scroll rail. Four across a 390px screen
 * is under ninety pixels per product, which is not a product card.
 */
export function FeaturedCollection({
  config,
  products,
  heading,
}: {
  config: FeaturedConfig;
  products: RailProduct[];
  /** Resolved title — the authored heading, or the collection's own. */
  heading: string;
}) {
  const href = `/collections/${config.handle}`;
  const centred = config.align === "center";
  const headingId = `featured-${config.handle}`;

  return (
    <section aria-labelledby={headingId} className="pt-14 md:pt-20">
      {centred ? (
        <div className="px-4 pb-8 text-center md:px-8">
          {config.eyebrow && <Eyebrow>{config.eyebrow}</Eyebrow>}
          <h2
            id={headingId}
            className="display mt-2.5 text-[clamp(1.5rem,3.5vw,2.25rem)] uppercase"
          >
            {heading}
          </h2>
          {config.body && (
            <p className="mx-auto mt-3 max-w-lg text-sm text-[var(--shop-mute)]">
              {config.body}
            </p>
          )}
        </div>
      ) : (
        <div className="px-4 pb-8 md:px-8">
          {config.eyebrow && (
            <Eyebrow className="pb-6 text-center">{config.eyebrow}</Eyebrow>
          )}
          <div className="flex items-end justify-between gap-6">
            <div>
              <h2
                id={headingId}
                className="display text-[clamp(1.5rem,3.5vw,2.25rem)] uppercase"
              >
                {heading}
              </h2>
              {config.body && (
                <p className="mt-3 max-w-lg text-sm text-[var(--shop-mute)]">
                  {config.body}
                </p>
              )}
            </div>
            {config.cta && (
              <Link
                href={href}
                className="meta hidden shrink-0 cursor-pointer border-b border-[var(--shop-ink)] pb-1 text-[var(--shop-ink)] transition-opacity duration-200 hover:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--shop-ink)] sm:block"
              >
                {config.cta}
              </Link>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          "rail auto-cols-[62%] gap-4 sm:auto-cols-[38%] md:grid md:auto-cols-auto md:grid-cols-4 md:gap-6 md:overflow-visible",
          centred ? "px-4 md:px-8" : "px-4 md:px-8"
        )}
      >
        {products.map((product, i) => (
          <RailCard key={product.id} product={product} priority={i < 2} />
        ))}
      </div>

      {config.cta && (
        <div className={cn("px-4 pt-10 md:px-8", centred ? "text-center" : "sm:hidden")}>
          <Link
            href={href}
            className={cn(
              "meta cursor-pointer transition-opacity duration-200 hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--shop-ink)]",
              centred
                ? "inline-flex min-h-11 items-center rounded-[4px] bg-[var(--shop-ink)] px-8 text-[var(--shop-canvas)]"
                : "inline-block border-b border-[var(--shop-ink)] pb-1 text-[var(--shop-ink)]"
            )}
          >
            {config.cta}
          </Link>
        </div>
      )}
    </section>
  );
}
