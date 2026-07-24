"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Quantity control for a cart line.
 *
 * Decrementing from 1 removes the line rather than refusing — that is what the
 * shopper means by pressing minus on a single item, and making them find a
 * separate remove button for it is a small, avoidable annoyance. The button is
 * labelled "Remove" at that point so the destructive step is never a surprise.
 *
 * The ceiling comes from real inventory, so plus disables at the last unit in
 * stock rather than letting the shopper build a quantity checkout will reject.
 */
export function QuantityStepper({
  quantity,
  max,
  disabled,
  onChange,
  onRemove,
  label,
}: {
  quantity: number;
  /** Stock ceiling; null when the line is not inventory-limited. */
  max: number | null;
  disabled?: boolean;
  onChange: (quantity: number) => void;
  onRemove: () => void;
  /** Item name, for screen-reader-only button labels. */
  label: string;
}) {
  const atMax = max != null && quantity >= max;
  const removing = quantity <= 1;

  return (
    <div
      className="glass glass-pill glass-on-light inline-flex items-center"
      role="group"
      aria-label={`Quantity for ${label}`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => (removing ? onRemove() : onChange(quantity - 1))}
        className={cn(
          "glass-press flex size-10 cursor-pointer items-center justify-center rounded-full text-(--shop-ink)",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
          "disabled:cursor-not-allowed disabled:opacity-40"
        )}
      >
        <Minus className="size-4" aria-hidden />
        <span className="sr-only">
          {removing ? `Remove ${label}` : `Decrease quantity of ${label}`}
        </span>
      </button>

      <span
        className="min-w-7 text-center text-sm font-medium tabular-nums"
        aria-live="polite"
        aria-atomic
      >
        {quantity}
        <span className="sr-only"> in bag</span>
      </span>

      <button
        type="button"
        disabled={disabled || atMax}
        onClick={() => onChange(quantity + 1)}
        className={cn(
          "glass-press flex size-10 cursor-pointer items-center justify-center rounded-full text-(--shop-ink)",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
          "disabled:cursor-not-allowed disabled:opacity-40"
        )}
      >
        <Plus className="size-4" aria-hidden />
        <span className="sr-only">
          {atMax
            ? `No more ${label} available`
            : `Increase quantity of ${label}`}
        </span>
      </button>
    </div>
  );
}
