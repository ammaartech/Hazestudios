"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag, X } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-provider";
import { CartLineRow } from "./cart-line-row";

/**
 * The bag, as a panel over the page.
 *
 * Opens itself after an add. The alternative — a toast, or navigating to /cart —
 * either under-confirms or throws away the shopper's place in the drop, and on
 * a store built around a single collection the second cost is the higher one.
 *
 * Slides from the right on desktop and rises from the bottom on mobile, which
 * is the same decision the tab bar made: the phone gets a layout suited to a
 * thumb rather than a scaled-down desktop one.
 */
export function CartDrawer() {
  const { cart, drawerOpen, closeDrawer, setQuantity, remove, isPending } =
    useCart();
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // The cart page is the drawer's own content at full size; showing both at
  // once would be the same list twice.
  const onCartPage = pathname === "/cart";
  const open = drawerOpen && !onCartPage;

  /* Lock the page behind the panel, move focus into it, and restore focus to
     wherever it came from on close. */
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  /* Escape closes; Tab is kept inside the panel while it is open. A dialog that
     leaks focus to the page behind it is unusable with a keyboard. */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;

      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, closeDrawer]);

  if (!open) return null;

  const empty = cart.lines.length === 0;

  return (
    <div className="fixed inset-0 layer-sheet">
      <button
        type="button"
        aria-label="Close bag"
        onClick={closeDrawer}
        className="absolute inset-0 cursor-default bg-black/25 backdrop-blur-[2px]"
        style={{ animation: "cart-scrim 300ms ease-out" }}
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Your bag"
        className={cn(
          "glass glass-panel absolute flex flex-col overflow-hidden",
          // Mobile: a sheet above the tab bar. Desktop: a column against the edge.
          "inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] top-auto max-h-[82vh]",
          "md:inset-y-3 md:left-auto md:right-3 md:max-h-none md:w-[26rem]"
        )}
        style={{
          animation:
            "cart-sheet 460ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <header className="flex items-center justify-between gap-4 border-b border-(--shop-ink)/8 px-5 py-4">
          <h2 className="display text-lg tracking-[-0.02em]">
            Bag
            {cart.count > 0 && (
              <span className="ml-2 text-(--shop-mute)">({cart.count})</span>
            )}
          </h2>
          <button
            ref={closeButton}
            type="button"
            onClick={closeDrawer}
            className="glass-press -mr-1 flex size-10 cursor-pointer items-center justify-center rounded-full text-(--shop-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)"
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Close bag</span>
          </button>
        </header>

        {/* Lines a resolve step dropped, explained rather than left mysterious. */}
        {cart.removed.length > 0 && (
          <div
            role="status"
            className="border-b border-(--shop-ink)/8 bg-(--shop-cloud) px-5 py-3"
          >
            {cart.removed.map((message) => (
              <p key={message} className="text-sm text-(--shop-mute)">
                {message}
              </p>
            ))}
          </div>
        )}

        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-14 text-center">
            <ShoppingBag
              className="size-8 text-(--shop-stone)"
              strokeWidth={1.5}
              aria-hidden
            />
            <p className="text-sm text-(--shop-mute)">Your bag is empty.</p>
            <button
              type="button"
              onClick={closeDrawer}
              className="glass glass-pill glass-press glass-ink min-h-12 cursor-pointer px-6 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--shop-ink)"
            >
              Keep shopping
            </button>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-(--shop-ink)/8 overflow-y-auto px-5">
              {cart.lines.map((line) => (
                <CartLineRow
                  key={line.id}
                  line={line}
                  size="drawer"
                  disabled={isPending}
                  onQuantityChange={(quantity) => setQuantity(line.id, quantity)}
                  onRemove={() => remove(line.id)}
                />
              ))}
            </ul>

            <footer className="border-t border-(--shop-ink)/8 px-5 pb-5 pt-4">
              <div className="flex items-baseline justify-between">
                <span className="meta text-(--shop-mute)">Subtotal</span>
                <span className="text-lg font-medium tabular-nums">
                  {formatMoney(cart.subtotal, cart.currency)}
                </span>
              </div>
              <p className="mt-1 text-sm text-(--shop-mute)">
                Shipping and taxes calculated at checkout.
              </p>

              <Link
                href="/cart"
                onClick={closeDrawer}
                className="glass glass-pill glass-press glass-ink mt-4 flex min-h-14 cursor-pointer items-center justify-center px-8 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--shop-ink)"
              >
                View bag
              </Link>
              <button
                type="button"
                onClick={closeDrawer}
                className="glass-press mt-2 min-h-11 w-full cursor-pointer rounded-full text-sm text-(--shop-mute) transition-colors hover:text-(--shop-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)"
              >
                Keep shopping
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
