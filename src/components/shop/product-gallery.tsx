"use client";

import Image from "next/image";
import { useState } from "react";
import type { ProductImage } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Mobile: a full-bleed scroll-snap rail, so the photography stays edge to edge.
 * Desktop: a stacked column — editorial catalogs scroll, they don't carousel.
 */
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
                sizes="100vw"
                priority={i === 0}
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
            sizes="(max-width: 1280px) 55vw, 60vw"
            priority
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
