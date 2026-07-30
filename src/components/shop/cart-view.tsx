"use client";

import Link from "next/link";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { useCart } from "./cart-provider";
import { CartLineRow } from "./cart-line-row";

/**
 * The cart page.
 *
 * Reads from the client cart context rather than fetching its own copy: the
 * layout already resolved the cart on the server for the header badge, and
 * every mutation returns fresh server state into that same context. A second
 * fetch here would be a second source of truth to keep in step.
 *
 * The summary is sticky on desktop so the total stays in view while a long bag
 * scrolls, and flows inline on mobile where a pinned panel would eat the fold.
 */
export function CartView() {
  const { cart, setQuantity, remove, isPending } = useCart();

  const unavailable = cart.lines.filter((line) => !line.available);
  const canCheckout = cart.count > 0 && unavailable.length === 0;

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 px-4 py-24 text-center md:py-32">
        <ShoppingBag
          className="size-10 text-(--shop-stone)"
          strokeWidth={1.25}
          aria-hidden
        />
        <div>
          <h1 className="display text-2xl tracking-[-0.02em] md:text-3xl">
            Your bag is empty
          </h1>
          <p className="mt-3 text-sm text-(--shop-mute)">
            Nothing here yet — the current drop is a good place to start.
          </p>
        </div>
        <Link
          href="/"
          className="glass glass-pill glass-press glass-on-light flex min-h-14 cursor-pointer items-center px-8 text-base font-medium text-(--shop-ink) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--shop-ink)"
        >
          Shop the drop
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-16">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="display text-3xl tracking-[-0.03em] md:text-4xl">Bag</h1>
        <p className="meta text-(--shop-mute)">
          {cart.count} {cart.count === 1 ? "item" : "items"}
        </p>
      </header>

      {cart.removed.length > 0 && (
        <div
          role="status"
          className="glass glass-panel mt-6 px-5 py-4 text-sm text-(--shop-mute)"
        >
          {cart.removed.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-16">
        <ul className="divide-y divide-(--shop-ink)/8 border-y border-(--shop-ink)/8">
          {cart.lines.map((line) => (
            <CartLineRow
              key={line.id}
              line={line}
              disabled={isPending}
              onQuantityChange={(quantity) => setQuantity(line.id, quantity)}
              onRemove={() => remove(line.id)}
            />
          ))}
        </ul>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="glass glass-panel p-6">
            <h2 className="meta text-(--shop-mute)">Summary</h2>

            <dl className="mt-5 flex flex-col gap-3 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-(--shop-mute)">Subtotal</dt>
                <dd className="tabular-nums">
                  {formatMoney(cart.subtotal, cart.currency)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-(--shop-mute)">Shipping</dt>
                <dd className="text-(--shop-mute)">Calculated at checkout</dd>
              </div>
            </dl>

            <div className="mt-5 flex items-baseline justify-between border-t border-(--shop-ink)/10 pt-5">
              <span className="font-medium">Total</span>
              <span className="text-xl font-medium tabular-nums">
                {formatMoney(cart.subtotal, cart.currency)}
              </span>
            </div>

            {unavailable.length > 0 && (
              <p className="mt-4 text-sm text-(--shop-sale)">
                Remove the sold-out {unavailable.length === 1 ? "item" : "items"}{" "}
                above to continue.
              </p>
            )}

            {/* A link, not a button with an onClick: checkout is a page, so it
                should be openable in a new tab and reachable without JavaScript.
                When the bag cannot be checked out the anchor is swapped for a
                disabled button — an <a> has no disabled state worth trusting. */}
            {canCheckout ? (
              <Link
                href="/checkout"
                className="glass glass-pill glass-press glass-on-light mt-6 flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 px-8 text-base font-medium text-(--shop-ink) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--shop-ink)"
              >
                Checkout
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="glass glass-pill mt-6 flex min-h-14 w-full cursor-not-allowed items-center justify-center gap-2 bg-(--shop-cloud) px-8 text-base font-medium text-(--shop-stone)"
              >
                Checkout
                <ArrowRight className="size-4" aria-hidden />
              </button>
            )}

            <Link
              href="/"
              className="glass-press mt-3 flex min-h-11 cursor-pointer items-center justify-center rounded-full text-sm text-(--shop-mute) transition-colors hover:text-(--shop-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)"
            >
              Keep shopping
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
