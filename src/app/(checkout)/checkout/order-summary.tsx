"use client";

import Image from "next/image";
import { useRef } from "react";
import { Check, ChevronDown, Tag } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { shortVariantTitle } from "@/lib/variants";
import { cn } from "@/lib/utils";
import type { Cart } from "@/lib/shop/cart";
import type { CheckoutTotals } from "@/lib/shop/checkout-totals";
import type { DiscountQuote } from "./actions";

/**
 * What the shopper is buying and what it costs.
 *
 * Rendered inside the checkout `<form>` rather than beside it, so the discount
 * field is a real form control and submits with everything else. The
 * alternative — its own form, or a hidden mirror of its value — is one more
 * thing that can disagree with what the shopper can see.
 *
 * On desktop it is a sticky column that cannot be collapsed — there is room,
 * and a summary you have to open is a total you have to go looking for. On
 * mobile the same markup is a real `<details>`, so a shopper on a long bag can
 * fold it away and get to the address fields. Either way the header row carries
 * the total, so collapsing never hides the number that matters.
 */
export function OrderSummary({
  cart,
  totals,
  quote,
  applying,
  onApply,
}: {
  cart: Cart;
  totals: CheckoutTotals;
  quote: DiscountQuote | null;
  applying: boolean;
  onApply: (code: string) => void;
}) {
  const codeInput = useRef<HTMLInputElement>(null);

  const applied = quote?.ok ? quote : null;

  return (
    <aside className="lg:sticky lg:top-8 lg:self-start">
      {/* `group` + `group-open:` drives the caret from the element's own state,
          so no piece of React state has to be kept in step with a disclosure the
          browser already tracks. */}
      <details className="group glass glass-panel overflow-hidden" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 lg:pointer-events-none">
          <span className="meta flex items-center gap-2 text-(--shop-mute)">
            Order summary
            <span className="text-(--shop-stone)">
              ({cart.count} {cart.count === 1 ? "item" : "items"})
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span className="text-lg font-medium tabular-nums">
              {formatMoney(totals.total, cart.currency)}
            </span>
            <ChevronDown
              className="size-4 text-(--shop-mute) transition-transform duration-300 group-open:rotate-180 lg:hidden"
              aria-hidden
            />
          </span>
        </summary>

        <div className="border-t border-(--shop-ink)/8 px-6 pb-6 pt-5">
          <ul className="flex flex-col gap-4">
            {cart.lines.map((line) => (
              <li key={line.id} className="flex items-start gap-3">
                <div className="relative aspect-[4/5] w-14 shrink-0 overflow-hidden bg-(--shop-cloud)">
                  {line.image ? (
                    <Image
                      src={line.image}
                      alt=""
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  ) : (
                    <span className="meta absolute inset-0 flex items-center justify-center text-(--shop-stone)">
                      —
                    </span>
                  )}
                  {/* The quantity badge is how every checkout summary states
                      count without spending a whole line on it. */}
                  <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-(--shop-ink) text-[11px] font-medium tabular-nums text-(--shop-canvas)">
                    {line.quantity}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{line.title}</p>
                  {line.variantTitle && (
                    <p className="mt-0.5 truncate text-xs text-(--shop-mute)">
                      {shortVariantTitle(line.variantTitle)}
                    </p>
                  )}
                </div>

                <p className="shrink-0 text-sm tabular-nums">
                  {formatMoney(line.lineTotal, cart.currency)}
                </p>
              </li>
            ))}
          </ul>

          {/* ---- Discount ---- */}
          <div className="mt-6 border-t border-(--shop-ink)/8 pt-5">
            <div className="flex gap-2">
              <input
                ref={codeInput}
                name="discount_code"
                aria-label="Discount code"
                placeholder="Discount code"
                autoComplete="off"
                // Enter inside a form submits it. In this field that would place
                // the order, which is emphatically not what "apply my code"
                // means — so Enter is intercepted and routed to Apply.
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onApply(event.currentTarget.value);
                  }
                }}
                className="glass glass-on-light h-12 min-w-0 flex-1 rounded-2xl px-4 text-[15px] text-(--shop-ink) outline-none transition-shadow duration-300 placeholder:text-(--shop-stone) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)"
              />
              <button
                type="button"
                disabled={applying}
                onClick={() => onApply(codeInput.current?.value ?? "")}
                className="glass glass-on-light glass-pill glass-press h-12 shrink-0 cursor-pointer px-5 text-sm font-medium text-(--shop-ink) disabled:cursor-not-allowed disabled:opacity-60"
              >
                {applying ? "…" : "Apply"}
              </button>
            </div>

            {quote?.error && (
              <p role="status" className="mt-2 text-xs text-(--shop-sale)">
                {quote.error}
              </p>
            )}
            {applied && (
              <p
                role="status"
                className="mt-2 flex items-center gap-1.5 text-xs text-(--shop-success)"
              >
                <Check className="size-3.5" aria-hidden />
                {applied.freeShipping
                  ? "Free shipping applied"
                  : `${applied.code.toUpperCase()} applied`}
              </p>
            )}
          </div>

          {/* ---- Totals ---- */}
          <dl className="mt-5 flex flex-col gap-3 border-t border-(--shop-ink)/8 pt-5 text-sm">
            <Row label="Subtotal">
              {formatMoney(totals.subtotal, cart.currency)}
            </Row>

            {totals.discount > 0 && (
              <Row label="Discount" accent>
                <span className="flex items-center gap-1.5">
                  <Tag className="size-3.5" aria-hidden />−
                  {formatMoney(totals.discount, cart.currency)}
                </span>
              </Row>
            )}

            <Row label="Shipping">
              {totals.freeShipping ? (
                <span className="text-(--shop-success)">Free</span>
              ) : (
                formatMoney(totals.shipping, cart.currency)
              )}
            </Row>

            {totals.tax > 0 && (
              <Row label="Tax">{formatMoney(totals.tax, cart.currency)}</Row>
            )}
          </dl>

          <div className="mt-5 flex items-baseline justify-between border-t border-(--shop-ink)/10 pt-5">
            <span className="font-medium">Total</span>
            <span className="display text-2xl tracking-[-0.02em] tabular-nums">
              {formatMoney(totals.total, cart.currency)}
            </span>
          </div>
        </div>
      </details>
    </aside>
  );
}

function Row({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-(--shop-mute)">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          accent ? "text-(--shop-success)" : "text-(--shop-ink)"
        )}
      >
        {children}
      </dd>
    </div>
  );
}
