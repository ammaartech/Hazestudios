import Image from "next/image";
import Link from "next/link";
import {
  HAZE_ARRIVALS,
  HAZE_LOOKBOOK,
  HAZE_TILES,
} from "@/lib/shop/haze-studios-content";
import { cn } from "@/lib/utils";
import { Price } from "./price";
import { revealProps } from "./reveal";

/* -------------------------------------------------------------------------- */
/* Lookbook                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Four styling frames, each shoppable.
 *
 * They read as two pairs — a flat-lay board beside the piece worn — so the row
 * stays a 2×2 grid on a phone rather than becoming a scroll rail. Breaking it
 * into a rail would separate each board from its outfit, which is the whole
 * point of the pairing.
 */
export function Lookbook() {
  return (
    <section aria-label="Lookbook">
      <div className="grid grid-cols-2 gap-3 px-3 md:grid-cols-4 md:gap-2 md:px-2">
        {HAZE_LOOKBOOK.frames.map((frame, i) => (
          <figure
            key={frame.image}
            className="relative isolate"
            {...revealProps("rise", i)}
          >
            <Image
              src={frame.image}
              alt={frame.alt}
              width={1080}
              height={1800}
              loading={i < 2 ? "eager" : "lazy"}
              sizes="(max-width: 768px) 50vw, 25vw"
              className="aspect-[3/5] w-full object-cover"
            />
            <Link
              href={`/products/${frame.handle}`}
              className="glass-press absolute inset-x-3 bottom-5 flex min-h-11 cursor-pointer items-center justify-center rounded-[4px] border border-white/90 text-center text-[0.8125rem] text-white backdrop-blur-[2px] transition-colors duration-300 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white md:inset-x-6"
            >
              {frame.cta}
            </Link>
          </figure>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* New arrivals                                                                */
/* -------------------------------------------------------------------------- */

export interface ArrivalTag {
  handle: string;
  title: string;
  price: number;
  compareAt: number | null;
  image: string | null;
}

/**
 * Two tall campaign frames, each with a product card pinned to a bottom corner.
 *
 * The card's title and price come from the catalogue, so they cannot drift from
 * what the product page charges. A handle that no longer resolves renders the
 * photograph alone rather than a card quoting a price for something unbuyable.
 */
export function Arrivals({ tags }: { tags: ArrivalTag[] }) {
  const byHandle = new Map(tags.map((tag) => [tag.handle, tag]));

  return (
    <section aria-label={HAZE_ARRIVALS.eyebrow} className="grid gap-2 px-2 md:grid-cols-2">
      {HAZE_ARRIVALS.frames.map((frame, i) => {
        const tag = byHandle.get(frame.handle);

        return (
          /* Two columns that open outward from the gutter — each frame arrives
             from the side it occupies. On a phone they stack, and the mobile
             rules turn both back into a rise: 44px of lateral travel inside a
             single-column layout is motion the viewport would clip anyway. */
          <figure
            key={frame.image}
            className="relative isolate"
            {...revealProps(i === 0 ? "left" : "right")}
          >
            <Image
              src={frame.image}
              alt={frame.alt}
              width={1600}
              height={2000}
              sizes="(max-width: 768px) 100vw, 50vw"
              className="h-[400px] w-full object-cover md:h-[800px]"
            />

            {tag && (
              <Link
                href={`/products/${tag.handle}`}
                className={cn(
                  "glass-press absolute bottom-5 flex w-44 cursor-pointer items-center gap-3 rounded-[20px] bg-white p-2 shadow-sm transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
                  frame.align === "left" ? "left-5 md:left-8" : "right-5 md:right-8"
                )}
              >
                {tag.image && (
                  <Image
                    src={tag.image}
                    alt=""
                    width={160}
                    height={200}
                    className="aspect-[4/5] w-14 shrink-0 rounded-[12px] object-cover"
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold leading-tight text-[var(--shop-ink)]">
                    {tag.title}
                  </span>
                  <Price
                    amount={tag.price}
                    compareAt={tag.compareAt}
                    className="mt-1 text-[0.6875rem] text-[var(--shop-charcoal)]"
                  />
                </span>
              </Link>
            )}
          </figure>
        );
      })}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Closing tiles                                                               */
/* -------------------------------------------------------------------------- */

/** Three editorial doors into the catalogue, closing the page above the footer. */
export function Tiles() {
  return (
    <section className="mt-12 md:mt-16">
      <h2 className="sr-only">Shop by category</h2>
      <div className="rail auto-cols-[86%] gap-2 px-2 md:grid md:auto-cols-auto md:grid-cols-3 md:overflow-visible">
        {HAZE_TILES.map((tile, i) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="group relative isolate flex h-[450px] items-center justify-center overflow-hidden bg-[var(--shop-cloud)] p-8 text-center focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white md:h-[550px]"
            {...revealProps("media", i)}
          >
            <Image
              src={tile.image}
              alt={tile.alt}
              fill
              sizes="(max-width: 768px) 86vw, 33vw"
              className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
            />
            <div className="absolute inset-0 bg-black/35" aria-hidden />

            <div className="relative">
              <p className="subheading text-white/85">{tile.eyebrow}</p>
              <h3 className="display mt-3 text-[clamp(2rem,4vw,3rem)] uppercase text-white">
                {tile.heading}
              </h3>
              <p className="mt-3 text-sm text-white/85">{tile.body}</p>
              <span className="meta mt-5 inline-block border-b border-white/70 pb-1 text-white transition-colors duration-300 group-hover:border-white">
                {tile.cta}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
