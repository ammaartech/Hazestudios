"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShoppingBag, LayoutGrid, User, X } from "lucide-react";
import type { Collection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-provider";

/**
 * Floating glass tab bar — the mobile navigation.
 *
 * Mobile does not get a shrunken desktop header; it gets its own architecture.
 * Navigation moves to the thumb, the header reduces to a wordmark, and this bar
 * owns getting around. That is why mobile is not an afterthought here: it is a
 * different, better layout for the device rather than the same one squeezed.
 *
 * Three destinations, each of which does something real — no decorative tabs
 * pointing at routes that do not exist yet.
 */

interface Tab {
  id: string;
  label: string;
  icon: typeof Home;
  href?: string;
  /** Tabs without an href open the collections sheet instead of navigating. */
  sheet?: boolean;
}

const TABS: Tab[] = [
  { id: "home", label: "Home", icon: Home, href: "/" },
  { id: "shop", label: "Shop", icon: LayoutGrid, sheet: true },
  { id: "bag", label: "Bag", icon: ShoppingBag, href: "/cart" },
  { id: "account", label: "Account", icon: User, href: "/account" },
];

/**
 * Hides the bar on downward scroll and returns it on the way up, so a long
 * product page is never fighting the chrome for vertical space.
 */
function useHideOnScrollDown() {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;

    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;

      // Ignore rubber-banding at the extremes and sub-pixel jitter, which would
      // otherwise flicker the bar continuously on iOS.
      if (y < 80 || Math.abs(delta) < 6) {
        if (y < 80) setHidden(false);
        lastY.current = y;
        return;
      }

      setHidden(delta > 0);
      lastY.current = y;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return hidden;
}

export function GlassTabBar({ collections }: { collections: Collection[] }) {
  const pathname = usePathname();
  const hidden = useHideOnScrollDown();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { count } = useCart();

  useEffect(() => {
    if (!sheetOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sheetOpen]);

  const activeIndex = (() => {
    if (sheetOpen) return TABS.findIndex((t) => t.sheet);
    if (pathname === "/") return 0;
    if (pathname.startsWith("/cart")) return 2;
    if (pathname.startsWith("/account")) return 3;
    if (pathname.startsWith("/collections") || pathname.startsWith("/products")) {
      return 1;
    }
    return -1;
  })();

  return (
    <>
      {/* --------------------------------------------------------------- */}
      {/* Collections sheet — the Shop tab morphs into this               */}
      {/* --------------------------------------------------------------- */}
      {sheetOpen && (
        <div className="fixed inset-0 layer-drawer md:hidden">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 cursor-default bg-black/25 backdrop-blur-[2px]"
          />

          <div
            className="glass glass-panel absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+5.75rem)] max-h-[70vh] overflow-y-auto p-2"
            role="dialog"
            aria-label="Collections"
            style={{ animation: "glass-rise 420ms cubic-bezier(0.16,1,0.3,1)" }}
          >
            <div className="flex items-center justify-between px-3 pb-2 pt-1">
              <span className="meta text-[var(--shop-mute)]">Collections</span>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close collections"
                className="glass-press -mr-1 flex size-9 cursor-pointer items-center justify-center rounded-full text-[var(--shop-ink)]"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <ul className="flex flex-col">
              {collections.map((collection) => {
                const href = `/collections/${collection.handle}`;
                const active = pathname === href;
                return (
                  <li key={collection.id}>
                    <Link
                      href={href}
                      // Closed here rather than in an effect on `pathname`:
                      // the click is the event, and reacting to the resulting
                      // route change would be a render cascade after the fact.
                      onClick={() => setSheetOpen(false)}
                      className={cn(
                        "glass-press flex min-h-13 items-center justify-between gap-4 rounded-2xl px-3 text-[15px] font-medium transition-colors duration-200",
                        active
                          ? "bg-[var(--shop-ink)]/8 text-[var(--shop-ink)]"
                          : "text-[var(--shop-charcoal)] active:bg-[var(--shop-ink)]/5"
                      )}
                    >
                      {collection.title}
                      {active && (
                        <span className="size-1.5 rounded-full bg-[var(--shop-ink)]" />
                      )}
                    </Link>
                  </li>
                );
              })}
              {collections.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-[var(--shop-mute)]">
                  No collections yet.
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------- */}
      {/* The bar                                                          */}
      {/* --------------------------------------------------------------- */}
      <nav
        aria-label="Primary"
        className={cn(
          "fixed inset-x-0 bottom-0 layer-tabbar flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] md:hidden",
          "transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          hidden && !sheetOpen && "translate-y-[calc(100%+1rem)]"
        )}
      >
        <div className="glass glass-pill relative flex w-full max-w-xs items-center p-1.5">
          {/* One travelling capsule rather than a per-item background: the
              selection appears to flow between tabs, which is the "dynamically
              morph" behaviour rather than an instant swap. */}
          {activeIndex >= 0 && (
            <span
              aria-hidden
              className="glass-indicator absolute inset-y-1.5 left-1.5 rounded-full bg-[var(--shop-ink)]/10"
              style={{
                width: `calc((100% - 0.75rem) / ${TABS.length})`,
                transform: `translateX(calc(100% * ${activeIndex}))`,
              }}
            />
          )}

          {TABS.map((tab, i) => {
            const active = i === activeIndex;
            const Icon = tab.icon;
            const badge = tab.id === "bag" && count > 0;
            const content = (
              <>
                <Icon
                  className={cn(
                    "size-[22px] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
                    active && "scale-105"
                  )}
                  strokeWidth={active ? 2.2 : 1.75}
                  aria-hidden
                />
                {badge && (
                  // Keyed on the count so React remounts it on every change and
                  // the pop animation actually replays — a persistent node would
                  // only animate the first time.
                  <span
                    key={count}
                    aria-hidden
                    className="absolute right-[calc(50%-1.15rem)] top-1 min-w-4 rounded-full bg-(--shop-ink) px-1 text-center text-[10px] font-semibold leading-4 text-(--shop-canvas) tabular-nums"
                    style={{
                      animation: "cart-badge-pop 340ms cubic-bezier(0.16,1,0.3,1)",
                    }}
                  >
                    {count > 9 ? "9+" : count}
                  </span>
                )}
                <span className="sr-only">
                  {tab.label}
                  {badge && `, ${count} ${count === 1 ? "item" : "items"}`}
                </span>
              </>
            );

            const classes = cn(
              "glass-press relative z-10 flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-full transition-colors duration-300",
              active ? "text-[var(--shop-ink)]" : "text-[var(--shop-mute)]"
            );

            return tab.sheet ? (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSheetOpen((v) => !v)}
                aria-expanded={sheetOpen}
                aria-current={active ? "page" : undefined}
                className={classes}
              >
                {content}
              </button>
            ) : (
              <Link
                key={tab.id}
                href={tab.href!}
                onClick={() => setSheetOpen(false)}
                aria-current={active ? "page" : undefined}
                className={classes}
              >
                {content}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
