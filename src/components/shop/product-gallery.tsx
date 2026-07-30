"use client";

import Image from "next/image";
import { useState } from "react";
import type { ProductImage } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Mobile: a full-bleed scroll-snap rail, so the photography stays edge to edge.
 * Desktop: a stacked column — editorial catalogs scroll, they don't carousel.
 */
/**
 * Both layouts below sit in the DOM at once and only one is ever visible, but
 * each renders the opening shot eagerly — so the page used to fetch the largest
 * image on it twice, at two different widths, on every device.
 *
 * Sharing one `sizes` string fixes that without touching the markup: at any
 * given viewport both elements resolve to the *same* CDN URL, so whichever one
 * is hidden costs a cache hit instead of a second download. The breakpoint here
 * has to track the `md:hidden` / `hidden md:block` pair below — 767px, because
 * Tailwind's `md` takes over at 768.
 */
const GALLERY_SIZES = "(max-width: 767px) 100vw, 60vw";

/** Fabric texture at this size is what the customer is actually buying. */
const GALLERY_QUALITY = 90;

export function ProductGallery({
  images,
  title,
}: {
  images: ProductImage[];
  title: string;
}) {
  const [active, setActive] = useState(0);

  if (!images.length) {
    return (
      <div className="flex aspect-[4/5] items-center justify-center bg-[var(--shop-cloud)]">
        <span className="meta text-[var(--shop-stone)]">No image</span>
      </div>
    );
  }

  return (
    <>
      {/* Mobile rail */}
      <div className="md:hidden">
        <ul className="flex snap-x snap-mandatory overflow-x-auto">
          {images.map((image, i) => (
            <li key={image.id} className="relative aspect-[4/5] w-full shrink-0 snap-center">
              <Image
                src={image.url}
                alt={image.alt || `${title} — view ${i + 1}`}
                fill
                sizes={GALLERY_SIZES}
                /* First frame is what a phone lands on, so it must not wait for
                   the lazy-load threshold; the rest are a swipe away. */
                loading={i === 0 ? "eager" : "lazy"}
                quality={GALLERY_QUALITY}
                className="bg-[var(--shop-cloud)] object-cover"
              />
            </li>
          ))}
        </ul>
        {images.length > 1 && (
          <p className="meta mt-3 px-4 text-[var(--shop-mute)]">
            Swipe · {images.length} views
          </p>
        )}
      </div>

      {/* Desktop stack */}
      <div className="hidden md:block">
        <div className="relative aspect-[4/5] bg-[var(--shop-cloud)]">
          <Image
            src={images[active].url}
            alt={images[active].alt || `${title} — view ${active + 1}`}
            fill
            sizes={GALLERY_SIZES}
            /* The opening shot is the LCP and the reason the page exists, so it
               earns a real <link rel=preload> — but only while it *is* the
               opening shot. Once the shopper picks a thumbnail, preloading the
               image we are already displaying buys nothing. */
            preload={active === 0}
            quality={GALLERY_QUALITY}
            className="object-cover"
          />
        </div>

        {images.length > 1 && (
          <ul className="mt-2 grid grid-cols-4 gap-2">
            {images.map((image, i) => (
              <li key={image.id}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-label={`View ${i + 1} of ${images.length}`}
                  aria-current={i === active ? "true" : undefined}
                  className={cn(
                    "relative block aspect-square w-full cursor-pointer bg-[var(--shop-cloud)] transition-opacity duration-200",
                    i === active
                      ? "outline-2 -outline-offset-2 outline-[var(--shop-ink)]"
                      : "opacity-60 hover:opacity-100"
                  )}
                >
                  <Image
                    src={image.url}
                    alt=""
                    aria-hidden
                    fill
                    sizes="12vw"
                    className="object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
