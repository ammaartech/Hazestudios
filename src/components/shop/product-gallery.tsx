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
  const rail = useRef<HTMLUListElement>(null);
  const thumbs = useRef<(HTMLLIElement | null)[]>([]);

  /**
   * The filmstrip scrolls for two reasons — the shopper dragging it, and us
   * centring the current thumb after a swipe on the stage — and only the first
   * should move the photograph. A scroll event carries no such flag, so we set
   * one before every scroll we cause, and clear it once the strip goes quiet.
   *
   * `scrubbing` is the mirror of it: while the shopper is dragging, the strip
   * belongs to their finger and we must not scroll it under them.
   */
  const railProgrammatic = useRef(false);
  const scrubbing = useRef(false);
  const railIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const railFrame = useRef<number | null>(null);

  /** Restarts the quiet-timer that ends both flags. */
  const armRailIdle = useCallback((delay: number) => {
    if (railIdle.current) clearTimeout(railIdle.current);
    railIdle.current = setTimeout(() => {
      railProgrammatic.current = false;
      scrubbing.current = false;
    }, delay);
  }, []);

  useEffect(() => {
    return () => {
      if (railIdle.current) clearTimeout(railIdle.current);
      if (railFrame.current !== null) cancelAnimationFrame(railFrame.current);
    };
  }, []);

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

  /**
   * Which thumbnail is sitting on the strip's centre line — the one the
   * selection is read from while the shopper drags.
   *
   * Measured with `getBoundingClientRect` rather than `offsetLeft`, because the
   * two are relative to different origins: `scrollLeft` is the strip's own
   * content box, while `offsetLeft` is whatever positioned ancestor the browser
   * finds above it. Comparing viewport coordinates is right whatever that
   * ancestor turns out to be.
   */
  const centeredThumb = useCallback(() => {
    const root = rail.current;
    if (!root) return null;

    const bounds = root.getBoundingClientRect();
    const line = bounds.left + bounds.width / 2;

    let best: number | null = null;
    let shortest = Infinity;
    thumbs.current.forEach((node, i) => {
      if (!node) return;
      const box = node.getBoundingClientRect();
      const distance = Math.abs(box.left + box.width / 2 - line);
      if (distance < shortest) {
        shortest = distance;
        best = i;
      }
    });
    return best;
  }, []);

  /**
   * Dragging the strip moves the photograph, live — the gallery-app gesture.
   * The stage is scrolled instantly rather than smoothly: this is a scrub, so
   * the shot has to track the finger rather than chase it.
   */
  const handleRailScroll = () => {
    armRailIdle(140);
    if (railProgrammatic.current) return;

    scrubbing.current = true;

    // One read per frame at most. Scroll fires far faster than the screen
    // refreshes, and every measurement here forces layout.
    if (railFrame.current !== null) return;
    railFrame.current = requestAnimationFrame(() => {
      railFrame.current = null;
      const index = centeredThumb();
      if (index !== null && index !== active) show(index);
    });
  };

  /**
   * A finger or cursor landing on the strip hands ownership of the scroll back
   * to the shopper. Without it, a drag that interrupts our own smooth centring
   * would keep the quiet-timer alive while the programmatic flag was still up —
   * the strip would move and the photograph would not, for as long as they
   * kept dragging.
   *
   * Deliberately does *not* raise `scrubbing`: a tap is a pointer event too,
   * and a tap has to leave the strip free to centre what it selected.
   */
  const claimRail = () => {
    railProgrammatic.current = false;
  };

  /** Brings a thumb to the centre line, flagged as ours so it isn't read back. */
  const centerThumb = useCallback(
    (index: number) => {
      const node = thumbs.current[index];
      if (!node) return;

      // Armed *before* the scroll and with room to spare: if the strip is
      // already centred this produces no scroll events at all, and a flag left
      // standing would swallow the shopper's next drag.
      railProgrammatic.current = true;
      armRailIdle(400);
      node.scrollIntoView({ block: "nearest", inline: "center" });
    },
    [armRailIdle]
  );

  /**
   * A tap on a thumbnail takes this path rather than falling out of the effect
   * below, so it behaves the same whether or not the strip happens to be moving
   * when the tap lands: the shot changes and the thumb comes to the centre.
   */
  const select = (index: number) => {
    scrubbing.current = false;
    show(index);
    centerThumb(index);
  };

  /**
   * The other direction: a swipe on the stage pulls the strip along so the
   * current shot is always the one under the centre line. Skipped while the
   * shopper is scrubbing — that is their finger's scroll, not ours.
   */
  useEffect(() => {
    if (scrubbing.current) return;
    centerThumb(active);
  }, [active, centerThumb]);

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
          ref={rail}
          onScroll={handleRailScroll}
          onPointerDown={claimRail}
          className="filmstrip mt-2 gap-2"
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
                onClick={() => select(i)}
                aria-label={`View ${i + 1} of ${images.length}`}
                aria-current={i === active ? "true" : undefined}
                className={cn(
                  "relative block aspect-square w-full cursor-pointer bg-[var(--shop-cloud)] transition-opacity duration-200",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-ink)]",
                  // The active thumb is the one at full strength; the rest sit
                  // back. No rim — on a wall of product shots the frame was
                  // louder than the photograph it was pointing at.
                  i !== active && "opacity-60 hover:opacity-100"
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
