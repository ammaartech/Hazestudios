"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ShopProduct, ShopVariant } from "@/lib/shop/queries";
import { sortOptionValues } from "@/lib/variants";
import { cn } from "@/lib/utils";
import { Price } from "./price";

/**
 * Option selection for a product with up to two axes (Size, Colour).
 *
 * Availability is resolved against real inventory_levels: a value is only
 * disabled when *every* variant containing it is out of stock, so a shopper
 * can still pick "Black" when Black/M is gone but Black/L isn't. The selected
 * combination's own stock then drives the CTA.
 */
export function VariantPicker({ product }: { product: ShopProduct }) {
  const options = product.options;
  const [selection, setSelection] = useState<Record<string, string>>(() => {
    // Preselect a single-value axis (e.g. "One Size") — there's no choice to make.
    const initial: Record<string, string> = {};
    for (const opt of options) {
      if (opt.values.length === 1) initial[opt.name] = opt.values[0];
    }
    return initial;
  });

  const axis1 = options[0];
  const axis2 = options[1];

  /** The variant matching the current selection, once every axis is chosen. */
  const selected: ShopVariant | null = useMemo(() => {
    if (!options.length) return null;
    if (options.some((o) => !selection[o.name])) return null;
    return (
      product.variants.find(
        (v) =>
          v.option1 === selection[axis1.name] &&
          (!axis2 || v.option2 === selection[axis2.name])
      ) ?? null
    );
  }, [options, selection, product.variants, axis1, axis2]);

  /** Is any in-stock variant reachable if this axis takes this value? */
  const valueAvailable = (optionName: string, value: string) => {
    const other = options.find((o) => o.name !== optionName);
    const otherPick = other ? selection[other.name] : undefined;

    return product.variants.some((v) => {
      const onAxis1 = optionName === axis1.name;
      const matchesThis = onAxis1 ? v.option1 === value : v.option2 === value;
      if (!matchesThis) return false;
      // Respect the other axis only once it has actually been chosen.
      if (otherPick) {
        const otherMatches = onAxis1
          ? v.option2 === otherPick
          : v.option1 === otherPick;
        if (!otherMatches) return false;
      }
      return v.available;
    });
  };

  const price = selected?.price ?? product.price;
  const compareAt = selected?.compare_at_price ?? product.compare_at_price;

  const allChosen = options.length > 0 && options.every((o) => selection[o.name]);
  const canAdd = options.length
    ? Boolean(selected?.available)
    : product.inStock;

  const lowStock =
    selected && selected.available && selected.stock > 0 && selected.stock <= 3;

  /**
   * Tracks whether the inline CTA is on screen, so the sticky mobile bar can
   * stand down while it is. An IntersectionObserver rather than a scroll
   * listener: no per-frame work, and it stays correct when the page reflows.
   */
  const inlineCta = useRef<HTMLButtonElement>(null);
  const [ctaVisible, setCtaVisible] = useState(true);

  useEffect(() => {
    const node = inlineCta.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setCtaVisible(entry.isIntersecting),
      // A little bottom margin so the bar swaps in just before the button
      // clears the fold, rather than at the exact boundary.
      { rootMargin: "0px 0px -80px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const ctaLabel = !product.inStock
    ? "Sold out"
    : !allChosen && options.length
      ? `Select ${options.find((o) => !selection[o.name])?.name.toLowerCase()}`
      : canAdd
        ? "Add to bag"
        : "Sold out";

  function addToBag() {
    // Cart lands in the next pass — say so rather than silently doing nothing.
    toast.info("Cart is not wired up yet", {
      description: selected
        ? `${product.title} · ${selected.title}`
        : product.title,
    });
  }

  return (
    <div>
      <Price
        amount={price}
        compareAt={compareAt}
        className="text-xl md:text-2xl"
      />

      <div className="mt-8 flex flex-col gap-7">
        {options.map((option) => {
          // A single-value axis is stated, not offered as a choice.
          if (option.values.length === 1) {
            return (
              <div key={option.id}>
                <h2 className="meta text-[var(--shop-mute)]">{option.name}</h2>
                <p className="mt-2 text-sm">{option.values[0]}</p>
              </div>
            );
          }

          return (
            <fieldset key={option.id}>
              <legend className="meta text-[var(--shop-mute)]">
                {option.name}
                {selection[option.name] && (
                  <span className="ml-2 text-[var(--shop-ink)]">
                    {selection[option.name]}
                  </span>
                )}
              </legend>

              <div className="mt-3 flex flex-wrap gap-2">
                {sortOptionValues(option.name, option.values).map((value) => {
                  const active = selection[option.name] === value;
                  const available = valueAvailable(option.name, value);

                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={!available}
                      aria-pressed={active}
                      onClick={() =>
                        setSelection((prev) => ({ ...prev, [option.name]: value }))
                      }
                      className={cn(
                        "glass-press min-h-12 min-w-14 cursor-pointer rounded-full px-5 text-sm font-medium",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
                        active
                          ? "glass glass-ink"
                          : "glass glass-on-light text-(--shop-ink)",
                        // Struck-through rather than merely faded, so the
                        // unavailable state doesn't rely on contrast alone.
                        !available &&
                          "cursor-not-allowed text-(--shop-stone) line-through opacity-60"
                      )}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>

      {/* Stock messaging — reserved height so the CTA doesn't jump as it changes. */}
      <p className="mt-6 min-h-5 text-sm" aria-live="polite">
        {!product.inStock ? (
          <span className="text-[var(--shop-mute)]">Sold out</span>
        ) : allChosen && selected && !selected.available ? (
          <span className="text-[var(--shop-mute)]">
            {selected.title} is sold out
          </span>
        ) : lowStock ? (
          <span className="text-[var(--shop-sale)]">
            Low stock — {selected!.stock} left
          </span>
        ) : allChosen && selected ? (
          <span className="text-[var(--shop-success)]">In stock</span>
        ) : null}
      </p>

      <button
        ref={inlineCta}
        type="button"
        onClick={addToBag}
        disabled={!canAdd}
        className={cn(
          "glass glass-pill glass-press mt-4 min-h-14 w-full cursor-pointer px-8 text-base font-medium",
          "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--shop-ink)",
          canAdd
            ? "glass-ink"
            : "cursor-not-allowed bg-(--shop-cloud) text-(--shop-stone)"
        )}
      >
        {ctaLabel}
      </button>

      {/* ----------------------------------------------------------------- */}
      {/* Sticky mobile buy bar                                              */}
      {/* ----------------------------------------------------------------- */}
      {/* Appears only once the inline button has scrolled away, so the two are
          never on screen together. Sits above the tab bar rather than replacing
          it — on a product page, buying and navigating are both live actions. */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 layer-sticky px-4 pb-[calc(env(safe-area-inset-bottom,0px)+4.75rem)] md:hidden",
          "transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          ctaVisible
            ? "pointer-events-none translate-y-4 opacity-0"
            : "translate-y-0 opacity-100"
        )}
        aria-hidden={ctaVisible}
      >
        <div className="glass glass-pill flex items-center gap-3 p-1.5 pl-5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-(--shop-ink)">
              {product.title}
            </p>
            <Price
              amount={price}
              compareAt={compareAt}
              className="text-[13px]"
            />
          </div>
          <button
            type="button"
            onClick={addToBag}
            disabled={!canAdd}
            tabIndex={ctaVisible ? -1 : 0}
            className={cn(
              "glass glass-pill glass-press min-h-12 shrink-0 cursor-pointer px-6 text-sm font-medium",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
              canAdd
                ? "glass-ink"
                : "cursor-not-allowed bg-(--shop-cloud) text-(--shop-stone)"
            )}
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
