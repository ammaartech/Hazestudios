"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { RailProduct } from "@/lib/shop/swatches";
import { cn } from "@/lib/utils";
import { Price } from "./price";
import { revealProps } from "./reveal";

const SIZES = "(max-width: 640px) 62vw, (max-width: 1024px) 33vw, 24vw";

/**
 * A product card on a carousel rail.
 *
 * Deliberately not one big `<Link>`: the colour chips are controls, and an
 * anchor may not contain a button. So the photograph and the title are each
 * their own link to the product, and the chips sit between them as buttons —
 * which is also the behaviour a shopper expects, since picking a colour should
 * preview it rather than navigate away.
 */
export function RailCard({
  product,
  eager = false,
  revealIndex = 0,
}: {
  product: RailProduct;
  /** Set on the first few cards so the rail's leading images aren't lazy-loaded. */
  eager?: boolean;
  /** Position in the row's entrance cascade. */
  revealIndex?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const href = `/products/${product.handle}`;

  const active = selected !== null ? product.swatches[selected] : null;
  const primary = active?.image ?? product.image;
  // Once a colour is chosen the hover shot belongs to the old colourway, so it
  // is dropped rather than cross-fading to the wrong garment.
  const hover = active ? null : product.hoverImage;

  return (
    /* The attributes sit on the card's own root rather than on a wrapper: in a
       rail this element is the scroll-snap target, and in the desktop grid it
       is the grid item — a box around it would take over both roles. */
    <article className="flex flex-col" {...revealProps("rise", revealIndex)}>
      <div className="relative aspect-[4/5] overflow-hidden bg-[var(--shop-cloud)]">
        <Link
          href={href}
          tabIndex={-1}
          aria-hidden
          className="group/media relative block size-full"
        >
          {primary ? (
            <>
              <Image
                key={primary}
                src={primary}
                alt=""
                fill
                sizes={SIZES}
                loading={eager ? "eager" : "lazy"}
                className={cn(
                  "object-cover transition-opacity duration-300",
                  hover && "group-hover/media:opacity-0",
                  !product.inStock && "opacity-60"
                )}
              />
              {hover && (
                <Image
                  src={hover}
                  alt=""
                  fill
                  sizes={SIZES}
                  className="object-cover opacity-0 transition-opacity duration-300 group-hover/media:opacity-100"
                />
              )}
            </>
          ) : (
            <span className="meta grid size-full place-items-center text-[var(--shop-stone)]">
              No image
            </span>
          )}
        </Link>

        {/* Floating over photography — the one stratum the glass belongs to. */}
        {product.badge && (
          <span className="meta glass glass-dark glass-pill absolute left-3 top-3 px-3 py-1.5 text-white">
            {product.badge}
          </span>
        )}
      </div>

      {product.swatches.length > 0 && (
        <ul className="mt-3.5 flex flex-wrap gap-1.5">
          {product.swatches.map((swatch, i) => (
            <li key={swatch.value}>
              <button
                type="button"
                onClick={() => setSelected(selected === i ? null : i)}
                onMouseEnter={() => setSelected(i)}
                aria-pressed={selected === i}
                title={swatch.value}
                className={cn(
                  "glass-press block size-4 cursor-pointer rounded-full transition-[box-shadow] duration-300",
                  // The ring is the selection, drawn outside the chip so it never
                  // eats into the colour it is describing.
                  selected === i
                    ? "ring-1 ring-[var(--shop-ink)] ring-offset-2 ring-offset-[var(--shop-canvas)]"
                    : swatch.pale
                      // Pale chips would otherwise vanish against the white card.
                      ? "ring-1 ring-[var(--shop-hairline)]"
                      : "ring-0",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-ink)]"
                )}
                style={{ backgroundColor: swatch.color }}
              >
                <span className="sr-only">{swatch.value}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 text-center">
        <h3 className="text-sm font-semibold text-[var(--shop-ink)]">
          <Link
            href={href}
            className="cursor-pointer transition-opacity duration-200 hover:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--shop-ink)]"
          >
            {product.title}
          </Link>
        </h3>

        <Price
          amount={product.price}
          compareAt={product.compareAt}
          className="mt-1.5 justify-center text-sm text-[var(--shop-charcoal)]"
        />

      </div>

      {/* Spec chips — fabric weight, composition. Outlined and left-aligned so
          they read as a datasheet under the card rather than as more copy. */}
      {product.labels.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {product.labels.map((label) => (
            <li
              key={label}
              className="border border-[var(--shop-hairline)] px-2 py-1 text-[0.625rem] uppercase tracking-[0.08em] text-[var(--shop-charcoal)]"
            >
              {label}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
