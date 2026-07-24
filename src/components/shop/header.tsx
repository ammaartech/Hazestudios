"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { ShoppingBag, User } from "lucide-react";
import type { Collection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-provider";

/**
 * Scroll position, read as the external store it is. The snapshot is a boolean
 * rather than the raw offset, so it only changes on the one transition the
 * header cares about instead of on every pixel.
 */
function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

const isPastTop = () => window.scrollY > 24;
/** Server render has no scroll offset; the header starts at the top. */
const atTopOnServer = () => false;

/**
 * Storefront header.
 *
 * Two states, because the page has two backdrops. Over the campaign hero the
 * bar is transparent with white type — the photograph is the design and chrome
 * should not box it in. Once the hero scrolls away the bar condenses into
 * glass, refracting the content passing beneath it.
 *
 * On mobile it reduces to a wordmark: navigation lives in the thumb-reachable
 * tab bar instead, so the top of a phone screen stays given over to product.
 */
export function ShopHeader({
  storeName,
  collections,
}: {
  storeName: string;
  collections: Collection[];
}) {
  const pathname = usePathname();
  const pastTop = useSyncExternalStore(
    subscribeToScroll,
    isPastTop,
    atTopOnServer
  );
  const { count, openDrawer } = useCart();

  // Only the home page opens on a full-bleed hero; everywhere else the header
  // sits on white from the first pixel and is glass immediately.
  const overHero = pathname === "/";
  const scrolled = !overHero || pastTop;

  const links = collections.map((c) => ({
    label: c.title,
    href: `/collections/${c.handle}`,
  }));

  return (
    <header
      className={cn(
        "sticky top-0 layer-sticky transition-[background-color,box-shadow,backdrop-filter] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
        scrolled
          ? "glass border-b border-white/20"
          : "bg-transparent text-white"
      )}
    >
      <div className="flex h-14 items-center gap-6 px-4 md:h-16 md:px-8">
        <Link
          href="/"
          className={cn(
            "display shrink-0 text-lg tracking-[-0.02em] transition-colors duration-500 md:text-xl",
            scrolled ? "text-[var(--shop-ink)]" : "text-white"
          )}
        >
          {storeName}
        </Link>

        <nav aria-label="Collections" className="ml-4 hidden md:block">
          <ul className="flex items-center gap-1">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "meta glass-press relative flex min-h-9 cursor-pointer items-center rounded-full px-4 transition-colors duration-300",
                      scrolled
                        ? active
                          ? "bg-[var(--shop-ink)]/8 text-[var(--shop-ink)]"
                          : "text-[var(--shop-mute)] hover:bg-[var(--shop-ink)]/5 hover:text-[var(--shop-ink)]"
                        : active
                          ? "bg-white/20 text-white"
                          : "text-white/75 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Hidden on mobile — the tab bar owns account and bag there. */}
          <Link
            href="/account"
            aria-label="Your account"
            className={cn(
              "glass-press hidden min-h-10 cursor-pointer items-center rounded-full px-3 transition-colors duration-300 md:flex",
              scrolled
                ? "text-(--shop-mute) hover:bg-(--shop-ink)/5 hover:text-(--shop-ink)"
                : "text-white/75 hover:bg-white/10 hover:text-white"
            )}
          >
            <User className="size-4" aria-hidden />
          </Link>

          {/* A real link to /cart that opens the drawer instead when it can:
              middle-click, ⌘-click and a JS-less load all still reach the page,
              but a plain click keeps the shopper where they are. On /cart
              itself the drawer would duplicate the page, so the link stands. */}
          <Link
            href="/cart"
            onClick={(event) => {
              if (
                pathname === "/cart" ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.button !== 0
              ) {
                return;
              }
              event.preventDefault();
              openDrawer();
            }}
            className={cn(
              "meta glass-press hidden min-h-10 cursor-pointer items-center gap-2 rounded-full px-4 transition-colors duration-300 md:flex",
              scrolled
                ? "bg-[var(--shop-ink)]/6 text-[var(--shop-ink)] hover:bg-[var(--shop-ink)]/10"
                : "bg-white/15 text-white hover:bg-white/25"
            )}
          >
            <ShoppingBag className="size-4" aria-hidden />
            {/* The count is announced, but the label is not a live region —
                a shopper stepping a quantity does not want it read out on
                every tap. The drawer opening is the confirmation. */}
            Bag ({count})
          </Link>
        </div>
      </div>
    </header>
  );
}
