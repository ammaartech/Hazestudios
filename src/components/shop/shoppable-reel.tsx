import Image from "next/image";
import Link from "next/link";
import { REEL } from "@/lib/shop/home-content";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./home-sections";
import { Price } from "./price";
import { ScrollRevealText, revealProps } from "./reveal";

export interface ReelItem {
  handle: string;
  title: string;
  price: number;
  compareAt: number | null;
  /** The customer's clip or photo — the tall frame that fills the card. */
  media: string;
  /** Whether `media` is a video file. */
  video: boolean;
  /** The product's own shot, in the chip that straddles the frame's edge. */
  thumb: string | null;
  /** Replaces the product title where the card credits a creator instead. */
  caption?: string;
}

/**
 * Customer posts, each tagged to the piece being worn.
 *
 * The frames are 9:16 because that is the shape the source material arrives in
 * — these are phone videos, and letterboxing them into a product-card crop
 * would throw away most of the outfit. The product chip deliberately straddles
 * the bottom edge of the frame: it ties the tag to the clip it came from, and
 * it is what makes the row read as tagged posts rather than as a second,
 * differently-shaped product grid.
 *
 * Video autoplays muted and loops, the way the source platform plays it, and
 * carries `playsInline` so iOS does not hijack it into fullscreen.
 */
export function ShoppableReel({ items }: { items: ReelItem[] }) {
  if (!items.length) return null;

  return (
    <section aria-labelledby="reel-heading" className="pt-14 md:pt-20">
      <div className="px-4 pb-8 text-center md:px-8">
        <Eyebrow {...revealProps("fade")}>{REEL.eyebrow}</Eyebrow>
        <h2
          id="reel-heading"
          className="display mt-2.5 text-[clamp(1.5rem,3.5vw,2.25rem)]"
          {...revealProps("rise", 1)}
        >
          <ScrollRevealText text={REEL.heading} />
        </h2>
      </div>

      <ul className="rail auto-cols-[52%] gap-3 px-4 sm:auto-cols-[30%] md:grid md:auto-cols-auto md:grid-cols-6 md:overflow-visible md:px-8">
        {items.map((item, i) => (
          /* Six narrow frames, so the cascade runs over the `<li>` — the snap
             target on a phone and the grid cell on a desktop, in both cases the
             box whose position the entrance is describing. */
          <li key={item.handle} {...revealProps("rise", i)}>
            <Link
              href={`/products/${item.handle}`}
              className="group block cursor-pointer overflow-hidden rounded-[6px] border border-[var(--shop-hairline-soft)] bg-[var(--shop-canvas)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-ink)]"
            >
              <div className="relative isolate aspect-[9/16] overflow-hidden bg-[var(--shop-cloud)]">
                {item.video ? (
                  <video
                    src={item.media}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    aria-hidden
                    className="size-full object-cover"
                  />
                ) : (
                  <Image
                    src={item.media}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 52vw, (max-width: 768px) 30vw, 16vw"
                    className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
                    // A reel file in /public is pre-compressed and passes
                    // through the loader as-is; the product-image fallback is a
                    // CDN URL the loader does resize.
                    unoptimized={item.media.startsWith("/")}
                  />
                )}

                {/* The tag, straddling the frame's edge. */}
                {item.thumb && (
                  <span className="absolute -bottom-5 left-1/2 z-10 block size-12 -translate-x-1/2 overflow-hidden rounded-[3px] border-2 border-white bg-[var(--shop-cloud)] shadow-sm">
                    <Image
                      src={item.thumb}
                      alt=""
                      width={96}
                      height={96}
                      className="size-full object-cover"
                      unoptimized={item.thumb.startsWith("/")}
                    />
                  </span>
                )}
              </div>

              {/* The chip overhangs the frame, so the caption starts below it;
                  without one that gap would just be a hole. */}
              <div
                className={cn(
                  "px-3 pb-4 text-center",
                  item.thumb ? "pt-8" : "pt-3"
                )}
              >
                <p className="line-clamp-2 text-[0.8125rem] font-medium leading-snug text-[var(--shop-ink)]">
                  {item.caption ?? item.title}
                </p>
                {!item.caption && (
                  <Price
                    amount={item.price}
                    compareAt={item.compareAt}
                    className="mt-2 justify-center text-[0.8125rem] font-semibold text-[var(--shop-ink)]"
                  />
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
