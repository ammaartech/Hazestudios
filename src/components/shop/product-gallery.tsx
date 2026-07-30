"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductImage } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One gallery for every breakpoint: a swipeable stage with a slideable
 * thumbnail rail under it.
 *
 * This used to be two galleries — a full-bleed rail for phones and a
 * click-to-swap stack for desktop — both in the DOM at once, with only one ever
 * visible. Beyond the duplicated markup that meant the two behaved differently:
 * a phone could swipe through the shots and a desktop could not, so the same
 * product read as two different pages. The stage below is a scroll-snap rail at
 * every width, which is native swipe on touch and arrow-driven with a mouse.
 */

/**
 * Both the stage and the thumbnails are capped by `--pdp-frame` (below), so the
 * widths they resolve to are bounded no matter how wide the monitor is.
 */
const GALLERY_SIZES = "(max-width: 767px) 100vw, (max-width: 1279px) 55vw, 41rem";

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
  const stage = useRef<HTMLUListElement>(null);
  const frames = useRef<(HTMLLIElement | null)[]>([]);
  const thumbs = useRef<(HTMLLIElement | null)[]>([]);

  /**
   * Which shot is on screen is owned by the stage's scroll position, not by
   * click handlers — otherwise a swipe would move the photograph without moving
   * the thumbnail marked current, and the two would disagree.
   */
  useEffect(() => {
    const root = stage.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (!Number.isNaN(index)) setActive(index);
        }
      },
      // Against the stage itself, so this measures the rail's own scroll rather
      // than the page's. Over half visible is unambiguous at one frame per view.
      { root, threshold: 0.6 }
    );

    for (const frame of frames.current) if (frame) observer.observe(frame);
    return () => observer.disconnect();
  }, [images.length]);

  /**
   * Scrolls the stage by whole frames.
   *
   * `scrollTo` on the container rather than `scrollIntoView` on the frame: each
   * frame is exactly one container wide, so the offset is exact, and scrolling
   * the element we already have a handle on cannot nudge the page vertically
   * the way `scrollIntoView` can when the gallery is only partly in view.
   */
  const show = useCallback((index: number) => {
    const root = stage.current;
    if (!root) return;
    const clamped = Math.min(Math.max(index, 0), images.length - 1);
    root.scrollTo({ left: clamped * root.clientWidth });
  }, [images.length]);

  /** Keeps the current thumbnail in view once the rail is long enough to scroll. */
  useEffect(() => {
    thumbs.current[active]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [active]);

  if (!images.length) {
    return (
      <div className="mx-auto flex aspect-[4/5] w-full max-w-[calc((100dvh-11rem)*0.8)] items-center justify-center bg-[var(--shop-cloud)]">
        <span className="meta text-[var(--shop-stone)]">No image</span>
      </div>
    );
  }

  const many = images.length > 1;

  return (
    /* The canvas is standardised here, once, for the whole gallery: a 4:5
       portrait frame whose height is capped against the viewport, so a tall
       monitor gets a photograph that still fits on screen next to the buy
       column instead of one the shopper has to scroll past. Capping the *width*
       is what holds the ratio — a max-height would simply flatten the box. */
    <div
      className="mx-auto w-full max-w-[calc((100dvh-11rem)*0.8)]"
      role="group"
      aria-roledescription="carousel"
      aria-label={`${title} — ${images.length} ${images.length === 1 ? "view" : "views"}`}
    >
      <div className="relative">
        <ul
          ref={stage}
          className="flex snap-x snap-mandatory overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.map((image, i) => (
            <li
              key={image.id}
              data-index={i}
              ref={(node) => {
                frames.current[i] = node;
              }}
              className="relative aspect-[4/5] w-full shrink-0 snap-center bg-[var(--shop-cloud)]"
              aria-label={`View ${i + 1} of ${images.length}`}
            >
              <Image
                src={image.url}
                alt={image.alt || `${title} — view ${i + 1}`}
                fill
                sizes={GALLERY_SIZES}
                /* The opening shot is the LCP and the reason the page exists.
                   The rest are a swipe away and are not worth blocking it. */
                loading={i === 0 ? "eager" : "lazy"}
                preload={i === 0}
                quality={GALLERY_QUALITY}
                /* `contain`, not `cover`. The catalogue mixes cut-outs shot on
                   white with full-frame lifestyle photography, and a single
                   crop across both is what put a model's head outside the
                   frame. Letterboxing against the canvas colour costs a band of
                   background and guarantees the whole garment is always visible
                   — which is the thing being sold. */
                className="object-contain"
              />
            </li>
          ))}
        </ul>

        {many && (
          <>
            {/* Pointer affordance. Touch already has the swipe, and a control
                laid over the photograph on a phone would cover the garment. */}
            <StageArrow
              direction="prev"
              disabled={active === 0}
              onClick={() => show(active - 1)}
            />
            <StageArrow
              direction="next"
              disabled={active === images.length - 1}
              onClick={() => show(active + 1)}
            />

            {/* Says how much more there is without the shopper having to count
                the thumbnails. `aria-live` off: the rail below is already the
                labelled control, and announcing on every swipe would talk over
                it. */}
            <p className="meta pointer-events-none absolute bottom-3 right-3 rounded-full bg-[var(--shop-ink)]/70 px-3 py-1 text-[0.6875rem] text-white md:bottom-4 md:right-4">
              {active + 1} / {images.length}
            </p>
          </>
        )}
      </div>

      {many && (
        <ul
          className="rail mt-2 auto-cols-[4.5rem] gap-2 md:auto-cols-[5.25rem]"
          style={{ ["--rail-gutter" as string]: "0px" }}
        >
          {images.map((image, i) => (
            <li
              key={image.id}
              ref={(node) => {
                thumbs.current[i] = node;
              }}
            >
              <button
                type="button"
                onClick={() => show(i)}
                aria-label={`View ${i + 1} of ${images.length}`}
                aria-current={i === active ? "true" : undefined}
                className={cn(
                  "relative block aspect-square w-full cursor-pointer bg-[var(--shop-cloud)] transition-opacity duration-200",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-ink)]",
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
                  sizes="6rem"
                  className="object-contain"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A stage control. Kept off touch layouts, and dimmed rather than removed at
 * the ends so the pair does not shift position as the shopper moves through.
 */
function StageArrow({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const next = direction === "next";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={next ? "Next image" : "Previous image"}
      className={cn(
        "glass glass-press absolute top-1/2 hidden size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full md:grid",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-ink)]",
        "transition-opacity duration-200",
        next ? "right-3" : "left-3",
        disabled ? "cursor-not-allowed opacity-0" : "opacity-100"
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("size-4", next && "rotate-180")}
        aria-hidden
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
