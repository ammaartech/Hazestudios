"use client";

import Image from "next/image";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import type { CartLine } from "@/lib/shop/cart";
import { shortVariantTitle } from "@/lib/variants";
import { cn } from "@/lib/utils";
import { Price } from "./price";
import { QuantityStepper } from "./quantity-stepper";

/**
 * One line in the bag. Shared by the drawer and the cart page, which differ in
 * scale rather than in structure — a single component keeps the two from
 * drifting apart as the cart gains features.
 *
 * Two states are worth more than the happy path: a line whose stock has fallen
 * below the chosen quantity, and one that has sold out entirely. Both are shown
 * in place with the reason stated, rather than being deleted behind the
 * shopper's back — the item is still what they wanted.
 */
export function CartLineRow({
  line,
  size = "page",
  disabled,
  onQuantityChange,
  onRemove,
}: {
  line: CartLine;
  size?: "drawer" | "page";
  disabled?: boolean;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  const compact = size === "drawer";
  // Abbreviated to match the chip the shopper actually pressed on the product
  // page: they chose "S", so the bag should not report a "Small".
  const variantTitle = line.variantTitle
    ? shortVariantTitle(line.variantTitle)
    : line.variantTitle;
  const label = [line.title, variantTitle].filter(Boolean).join(" · ");

  return (
    <li
      className={cn(
        "flex gap-4",
        compact ? "py-4" : "py-6",
        !line.available && "opacity-70"
      )}
    >
      <Link
        href={`/products/${line.handle}`}
        tabIndex={-1}
        aria-hidden
        className={cn(
          "relative shrink-0 overflow-hidden bg-(--shop-cloud)",
          compact ? "aspect-[4/5] w-20" : "aspect-[4/5] w-24 sm:w-28"
        )}
      >
        {line.image ? (
          <Image
            src={line.image}
            alt=""
            fill
            sizes={compact ? "80px" : "112px"}
            className="object-cover"
          />
        ) : (
          <span className="meta absolute inset-0 flex items-center justify-center text-(--shop-stone)">
            —
          </span>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3
              className={cn(
                "font-medium text-(--shop-ink)",
                compact ? "text-sm" : "text-[15px]"
              )}
            >
              <Link
                href={`/products/${line.handle}`}
                className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink) hover:underline"
              >
                {line.title}
              </Link>
            </h3>
            {variantTitle && (
              <p className="mt-0.5 truncate text-sm text-(--shop-mute)">
                {variantTitle}
              </p>
            )}
          </div>

          {/* Line total on the page, unit price in the drawer: the page is
              where totals are reconciled, the drawer is a glance. */}
          <Price
            amount={compact ? line.price : line.lineTotal}
            compareAt={
              compact
                ? line.compareAtPrice
                : line.compareAtPrice != null
                  ? line.compareAtPrice * line.quantity
                  : null
            }
            className={cn("shrink-0", compact ? "text-sm" : "text-[15px]")}
          />
        </div>

        {/* Status messaging, before the controls so it is read first. */}
        {!line.available ? (
          <p className="mt-2 text-sm text-(--shop-mute)">
            Sold out — remove to check out
          </p>
        ) : line.reduced ? (
          <p className="mt-2 text-sm text-(--shop-sale)">
            Only {line.maxQuantity} left — quantity reduced
          </p>
        ) : line.maxQuantity != null && line.maxQuantity <= 3 ? (
          <p className="mt-2 text-sm text-(--shop-sale)">
            Low stock — {line.maxQuantity} left
          </p>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          {line.available ? (
            <QuantityStepper
              quantity={line.quantity}
              max={line.maxQuantity}
              disabled={disabled}
              onChange={onQuantityChange}
              onRemove={onRemove}
              label={label}
            />
          ) : (
            <span />
          )}

          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className={cn(
              "glass-press flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm text-(--shop-mute)",
              "transition-colors hover:text-(--shop-ink)",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
              "disabled:cursor-not-allowed disabled:opacity-40"
            )}
          >
            <Trash2 className="size-4" aria-hidden />
            <span className={compact ? "sr-only" : undefined}>Remove</span>
            <span className="sr-only">{label}</span>
          </button>
        </div>
      </div>
    </li>
  );
}
