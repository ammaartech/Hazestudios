"use client";

import { useId, useRef, useState } from "react";
import type { RailProduct } from "@/lib/shop/swatches";
import { cn } from "@/lib/utils";
import { ProductRail } from "./product-rail";

export interface CarouselTab {
  label: string;
  products: RailProduct[];
}

/**
 * A tabbed set of product rails.
 *
 * Follows the tabs pattern properly — roving tabindex, arrow keys move between
 * tabs, Home/End jump to the ends — because a tablist that only responds to
 * clicks is a set of buttons wearing the wrong roles.
 */
export function TabCarousel({
  heading,
  subheading,
  tabs,
}: {
  heading: string;
  subheading?: string;
  tabs: CarouselTab[];
}) {
  const baseId = useId();
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (!tabs.length) return null;

  const focusTab = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    focusTab(keys[event.key]);
  };

  return (
    <section className="pt-16 md:pt-24">
      <div className="px-4 text-center md:px-8">
        <h2 className="display text-[clamp(1.75rem,4vw,2.75rem)]">{heading}</h2>
        {subheading && (
          <p className="mt-3 text-sm text-[var(--shop-mute)]">{subheading}</p>
        )}
      </div>

      {/* A single tablist is only warranted by a real choice; one collection
          renders as a plain rail with no chrome to click. */}
      {tabs.length > 1 && (
        <div
          role="tablist"
          aria-label={heading}
          onKeyDown={onKeyDown}
          className="mt-8 flex justify-center gap-2 px-4"
        >
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${i}`}
              aria-selected={active === i}
              aria-controls={`${baseId}-panel-${i}`}
              tabIndex={active === i ? 0 : -1}
              onClick={() => setActive(i)}
              className={cn(
                "meta glass-press relative cursor-pointer px-4 pb-3 pt-2 transition-colors duration-300",
                active === i
                  ? "text-[var(--shop-ink)]"
                  : "text-[var(--shop-stone)] hover:text-[var(--shop-charcoal)]"
              )}
            >
              {tab.label}
              <span
                aria-hidden
                className={cn(
                  "glass-indicator absolute inset-x-2 bottom-0 h-0.5 origin-center bg-[var(--shop-ink)] transition-transform duration-500",
                  active === i ? "scale-x-100" : "scale-x-0"
                )}
              />
            </button>
          ))}
        </div>
      )}

      {tabs.map((tab, i) => (
        <div
          key={tab.label}
          role="tabpanel"
          id={`${baseId}-panel-${i}`}
          aria-labelledby={`${baseId}-tab-${i}`}
          // Hidden rather than unmounted: switching tabs keeps each rail's
          // scroll position, and the inactive panel stays out of the tab order
          // and the accessibility tree for free.
          hidden={active !== i}
          className="mt-10"
        >
          <ProductRail products={tab.products} label={tab.label} priority={i === 0} />
        </div>
      ))}
    </section>
  );
}
