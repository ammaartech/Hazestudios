"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RailProduct } from "@/lib/shop/swatches";
import { cn } from "@/lib/utils";
import { RailCard } from "./rail-card";

/**
 * A horizontally scrolling product rail.
 *
 * The scroll container is the mechanism; the arrows only call `scrollBy` on it.
 * That keeps trackpad, touch and keyboard scrolling native, and means the
 * arrows can be hidden on touch — where they are redundant — without taking the
 * carousel with them.
 */
export function ProductRail({
  products,
  label,
  eager = false,
}: {
  products: RailProduct[];
  /** Names the rail for assistive tech, e.g. the collection title. */
  label: string;
  /** Set on the rail that lands above the fold, so its cards load immediately. */
  eager?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 1);
    // A rail that fits entirely reports max ≈ 0, which correctly parks both
    // arrows in the disabled state rather than offering a scroll that no-ops.
    setAtEnd(el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, products.length]);

  /** One card plus its gap, read off the DOM so it tracks the responsive width. */
  const step = (direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const width = card ? card.offsetWidth + 24 : el.clientWidth * 0.8;
    el.scrollBy({ left: width * direction });
  };

  if (!products.length) return null;

  const hidden = atStart && atEnd;

  return (
    <div className="group/rail relative">
      <div
        ref={ref}
        onScroll={measure}
        className="rail auto-cols-[62%] gap-6 px-4 sm:auto-cols-[38%] md:auto-cols-[30%] md:px-8 lg:auto-cols-[23%]"
        style={{ ["--rail-gutter" as string]: "2rem" }}
        role="group"
        aria-label={label}
        tabIndex={0}
      >
        {products.map((product, i) => (
          <RailCard key={product.id} product={product} eager={eager && i < 4} />
        ))}
      </div>

      {/* Hidden on touch, where the rail is dragged rather than stepped.
          Centred on the photography rather than on the card: the caption below
          each image is roughly a fifth of the card's height, which puts the
          middle of the image band at ~40% of it at every breakpoint the arrows
          are visible at. */}
      {!hidden && (
        <div
          className="pointer-events-none absolute inset-0 hidden md:block"
          aria-hidden
        >
          <Arrow side="left" disabled={atStart} onClick={() => step(-1)} />
          <Arrow side="right" disabled={atEnd} onClick={() => step(1)} />
        </div>
      )}
    </div>
  );
}

function Arrow({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      // The rail itself is focusable and scrollable by keyboard, so these are
      // pointer affordances only — exposing them again would put two ways to do
      // the same thing in the tab order.
      tabIndex={-1}
      aria-hidden
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "glass glass-pill glass-press pointer-events-auto absolute top-[40%] grid size-11 -translate-y-1/2 place-items-center text-[var(--shop-ink)]",
        "opacity-0 transition-opacity duration-300 group-hover/rail:opacity-100",
        disabled && "opacity-0!",
        side === "left" ? "left-2" : "right-2"
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
