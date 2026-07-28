import Image from "next/image";
import Link from "next/link";
import { ARRIVALS, HERO, LOOKBOOK, MOSAIC } from "@/lib/shop/home-content";
import { cn } from "@/lib/utils";
import { Price } from "./price";

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The campaign banner.
 *
 * Two crops rather than one: the desktop banner is a 2.5:1 letterbox and the
 * mobile one is square. Cropping the wide shot down to a phone would either
 * lose the subject or shrink it to nothing, so the art direction is switched at
 * the breakpoint by `<picture>` and the browser only ever downloads one.
 */
export function Hero() {
  return (
    <section className="relative isolate bg-[var(--shop-cloud)]">
      <picture>
        <source media="(min-width: 768px)" srcSet={HERO.image} />
        <img
          src={HERO.imageMobile}
          alt=""
          aria-hidden
          fetchPriority="high"
          className="aspect-square w-full object-cover md:aspect-[2.5/1]"
        />
      </picture>

      {/* The display type sits on photography, so it needs a guaranteed contrast
          floor rather than relying on whatever the image happens to be. */}
      <div className="absolute inset-0 bg-black/25" aria-hidden />

      <div className="absolute inset-0 grid place-items-center px-6 text-center">
        <div>
          <p className="meta text-white/85">{HERO.eyebrow}</p>
          <h1 className="display mt-4 text-[clamp(2.25rem,7vw,5rem)] text-white">
            {HERO.heading}
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-white/85 md:text-base">
            {HERO.body}
          </p>
          <Link
            href={`/collections/${HERO.cta.handle}`}
            className="meta glass glass-dark glass-pill glass-press mt-8 inline-flex min-h-12 cursor-pointer items-center px-8 text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            {HERO.cta.label}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section heading                                                             */
/* -------------------------------------------------------------------------- */

/** The centred rules-and-caps label that separates the editorial blocks. */
export function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "meta px-4 pb-6 pt-20 text-center text-[var(--shop-charcoal)] md:px-8 md:pt-28",
        className
      )}
    >
      {children}
    </h2>
  );
}

export function Divider() {
  return (
    <hr className="mx-4 mt-20 border-[var(--shop-hairline-soft)] md:mx-8 md:mt-28" />
  );
}

/* -------------------------------------------------------------------------- */
/* Lookbook                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Four styling frames in a row. Two of them carry a shoppable button; the other
 * two are flats that give the row its rhythm. On a phone the row becomes a
 * scroll rail rather than four unreadably narrow columns.
 */
export function Lookbook() {
  return (
    <section aria-label={LOOKBOOK.heading}>
      <div className="rail auto-cols-[78%] gap-2 px-4 sm:auto-cols-[42%] md:grid md:auto-cols-auto md:grid-cols-4 md:overflow-visible md:px-2">
        {LOOKBOOK.frames.map((frame) => (
          <figure key={frame.image} className="relative isolate">
            <Image
              src={frame.image}
              alt={frame.alt}
              width={1000}
              height={1250}
              sizes="(max-width: 640px) 78vw, (max-width: 768px) 42vw, 25vw"
              className="aspect-[4/5] w-full object-cover"
            />
            {"cta" in frame && frame.cta && (
              <Link
                href={`/products/${frame.handle}`}
                className="glass glass-dark glass-press absolute inset-x-4 bottom-5 flex min-h-11 cursor-pointer items-center justify-center rounded-[4px] text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white md:inset-x-6"
              >
                {frame.cta}
              </Link>
            )}
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
}

/**
 * Two campaign frames, each with a product tag pinned to a bottom corner.
 *
 * The tag's price comes from the catalogue, so it cannot drift from what the
 * product page charges. A handle that no longer resolves renders the photograph
 * alone rather than a card quoting a price for something unbuyable.
 */
export function Arrivals({ tags }: { tags: ArrivalTag[] }) {
  const byHandle = new Map(tags.map((t) => [t.handle, t]));

  return (
    <section aria-label={ARRIVALS.heading} className="grid gap-2 px-2 md:grid-cols-2">
      {ARRIVALS.frames.map((frame) => {
        const tag = byHandle.get(frame.handle);

        return (
          <figure key={frame.image} className="relative isolate">
            <Image
              src={frame.image}
              alt={frame.alt}
              width={1600}
              height={2000}
              sizes="(max-width: 768px) 100vw, 50vw"
              className="aspect-[4/5] w-full object-cover"
            />

            {tag && (
              <Link
                href={`/products/${tag.handle}`}
                className={cn(
                  "glass glass-press absolute bottom-4 flex w-40 cursor-pointer items-center gap-3 rounded-[6px] p-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white md:bottom-6",
                  frame.align === "left" ? "left-4 md:left-6" : "right-4 md:right-6"
                )}
              >
                <Image
                  src={frame.thumb}
                  alt=""
                  width={120}
                  height={150}
                  className="aspect-[4/5] w-12 shrink-0 rounded-[3px] object-cover"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[0.6875rem] font-semibold leading-tight text-[var(--shop-ink)]">
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
/* Mosaic                                                                      */
/* -------------------------------------------------------------------------- */

/** Three editorial doors into the catalogue, closing the page above the footer. */
export function Mosaic() {
  return (
    <section className="mt-20 grid gap-2 px-2 md:mt-28 md:grid-cols-3">
      <h2 className="sr-only">Shop by category</h2>
      {MOSAIC.map((tile) => (
        <Link
          key={tile.handle}
          href={`/collections/${tile.handle}`}
          className="group relative isolate flex min-h-[26rem] items-center justify-center overflow-hidden bg-[var(--shop-cloud)] p-8 text-center focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white"
        >
          <Image
            src={tile.image}
            alt={tile.alt}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
          />
          <div className="absolute inset-0 bg-black/35" aria-hidden />

          <div className="relative">
            <p className="meta text-white/80">{tile.eyebrow}</p>
            <h3 className="display mt-3 text-[clamp(2rem,4vw,3rem)] text-white">
              {tile.heading}
            </h3>
            <p className="mt-3 text-sm text-white/85">{tile.body}</p>
            <span className="meta mt-5 inline-block border-b border-white/70 pb-1 text-white transition-colors duration-300 group-hover:border-white">
              {tile.cta}
            </span>
          </div>
        </Link>
      ))}
    </section>
  );
}
