"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Search, ShoppingBag, User } from "lucide-react";
import type { Collection } from "@/lib/types";
import { resolveNav, type ResolvedGroup } from "@/lib/shop/nav";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-provider";
import {
  ScrambleText,
  scrambleDuration,
  usePrefersReducedMotion,
} from "./scramble-text";

/**
 * Storefront header.
 *
 * A three-part bar: navigation left, wordmark centred, actions right. The
 * wordmark is centred against the *viewport* rather than the space left over
 * between the two side groups, so it stays put as the menu and the bag count
 * change width — the alternative drifts a few pixels on every cart update.
 *
 * The bar is glass throughout rather than switching to transparent over a hero:
 * the campaign image starts below it, so there is no photograph to get out of
 * the way of, and content refracting under a fixed material reads as one
 * continuous surface as you scroll.
 */
export function ShopHeaderView({
  storeName,
  collections,
  pathname,
}: {
  storeName: string;
  collections: Collection[];
  /**
   * The current path, passed in rather than read from the router.
   *
   * On a route whose params are enumerated — every product and collection page
   * — the path is known while the shell is being built, so the real header is
   * prerendered into it. On the handful of routes that cannot be enumerated
   * (`/account/orders/[id]`, `/orders/[token]`) there is no such path, so the
   * layout renders this with an empty string as its Suspense fallback and the
   * router-aware version replaces it a moment later. An empty path simply
   * matches no nav item, so the fallback is the same bar with nothing marked
   * current — identical dimensions, nothing to shift.
   */
  pathname: string;
}) {
  const { count, openDrawer } = useCart();
  const groups = resolveNav(collections);

  // Which mega-menu panel is open, by index. One at a time — a menu bar that can
  // show two panels at once has stopped being a menu bar.
  const [open, setOpen] = useState<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Any navigation dismisses the panel; otherwise clicking a link leaves it
  // hanging over the page it just loaded. Adjusted during render rather than in
  // an effect, so the panel is already gone in the same commit as the new route
  // instead of flashing for one frame after it.
  const [routeAtOpen, setRouteAtOpen] = useState(pathname);
  if (routeAtOpen !== pathname) {
    setRouteAtOpen(pathname);
    setOpen(null);
  }

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  /** A short grace period so the diagonal from trigger to panel is forgiving. */
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(null), 180);
  };
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  return (
    <header className="sticky top-0 layer-sticky">
      <div
        className="glass border-b border-white/25"
        onMouseLeave={scheduleClose}
      >
        <div className="relative flex h-14 items-center px-4 md:h-16 md:px-8">
          {/* ---------------------------------------------------------------- */}
          {/* Navigation                                                        */}
          {/* ---------------------------------------------------------------- */}
          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {groups.map((group, i) => (
                <MenuItem
                  key={group.label}
                  group={group}
                  open={open === i}
                  onOpen={() => {
                    cancelClose();
                    setOpen(i);
                  }}
                  onClose={scheduleClose}
                  onToggle={() => setOpen(open === i ? null : i)}
                />
              ))}
            </ul>
          </nav>

          {/* Centred on the viewport, and `pointer-events-none` on the wrapper so
              the full-width track never swallows clicks meant for the nav. */}
          <div className="pointer-events-none absolute inset-x-0 flex justify-center">
            <Link
              href="/"
              className="display pointer-events-auto text-base font-semibold uppercase tracking-[0.06em] text-[var(--shop-ink)] md:text-lg"
            >
              {storeName}
            </Link>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Actions                                                           */}
          {/* ---------------------------------------------------------------- */}
          <div className="ml-auto flex items-center gap-0.5">
            <IconLink href="/search" label="Search">
              <Search className="size-[1.15rem]" aria-hidden />
            </IconLink>
            <IconLink href="/account" label="Your account" desktopOnly>
              <User className="size-[1.15rem]" aria-hidden />
            </IconLink>

            {/* A real link to /cart that opens the drawer instead when it can:
                middle-click, ⌘-click and a JS-less load all still reach the
                page, but a plain click keeps the shopper where they are. On
                /cart itself the drawer would duplicate the page. */}
            <Link
              href="/cart"
              aria-label={`Bag, ${count} ${count === 1 ? "item" : "items"}`}
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
              className="glass-press relative flex size-10 cursor-pointer items-center justify-center rounded-full text-[var(--shop-ink)] transition-colors duration-300 hover:bg-[var(--shop-ink)]/6"
            >
              <ShoppingBag className="size-[1.15rem]" aria-hidden />
              {count > 0 && (
                <span
                  className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-[var(--shop-ink)] text-[0.5625rem] font-semibold tabular-nums text-[var(--shop-canvas)]"
                  aria-hidden
                >
                  {count > 9 ? "9+" : count}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* The panel is a sibling of the bar, inside the same glass surface, so
            it extends the material downward instead of floating as a second
            pane over it. */}
        {groups.map((group, i) =>
          open === i && group.links.length ? (
            <MenuPanel
              key={group.label}
              group={group}
              onEnter={cancelClose}
              onLeave={scheduleClose}
            />
          ) : null
        )}
      </div>
    </header>
  );
}

/** The header as mounted on a live route, reading the path from the router. */
export function ShopHeader(props: {
  storeName: string;
  collections: Collection[];
}) {
  return <ShopHeaderView {...props} pathname={usePathname()} />;
}

/* -------------------------------------------------------------------------- */

function IconLink({
  href,
  label,
  children,
  desktopOnly = false,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
  desktopOnly?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "glass-press size-10 cursor-pointer items-center justify-center rounded-full text-[var(--shop-ink)] transition-colors duration-300 hover:bg-[var(--shop-ink)]/6",
        desktopOnly ? "hidden md:flex" : "flex"
      )}
    >
      {children}
    </Link>
  );
}

function MenuItem({
  group,
  open,
  onOpen,
  onClose,
  onToggle,
}: {
  group: ResolvedGroup;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: () => void;
}) {
  const panelId = useId();
  const hasPanel = group.links.length > 0;

  // A group that resolved to a single destination is a link, not a disclosure —
  // giving it a panel with one entry would be a menu that says its own name.
  if (!hasPanel && group.href) {
    return (
      <li>
        <Link
          href={group.href}
          onMouseEnter={onClose}
          className="meta glass-press flex min-h-9 cursor-pointer items-center rounded-full px-3.5 text-[var(--shop-ink)] transition-colors duration-300 hover:bg-[var(--shop-ink)]/6"
        >
          {group.label}
        </Link>
      </li>
    );
  }

  return (
    <li onMouseEnter={onOpen} onMouseLeave={onClose}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
        onFocus={onOpen}
        className="meta glass-press relative flex min-h-9 cursor-pointer items-center rounded-full px-3.5 text-[var(--shop-ink)] transition-colors duration-300 hover:bg-[var(--shop-ink)]/6"
      >
        {group.label}
        {/* The open indicator. A dot rather than a chevron: it marks position
            without implying a direction the panel does not travel in. */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-x-0 -bottom-0.5 mx-auto size-1 rounded-full bg-[var(--shop-ink)] transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0"
          )}
        />
      </button>
    </li>
  );
}

/**
 * How far apart the labels start tumbling, and the ceiling on that stagger.
 *
 * The panel should read its collections out one after another, but a menu that
 * takes a second to become legible is a menu that is broken. Capping the
 * cascade keeps a twelve-link group finishing in roughly the same time as a
 * four-link one — under 900ms including the longest label's own tumble.
 */
const STAGGER_MS = 60;
const STAGGER_CAP_MS = 300;

function MenuPanel({
  group,
  onEnter,
  onLeave,
}: {
  group: ResolvedGroup;
  onEnter: () => void;
  onLeave: () => void;
}) {
  // The stagger is motion in the same sense the tumble is, so it goes away with
  // it rather than leaving a reader waiting for sub-copy that will never move.
  const reduced = usePrefersReducedMotion();

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="hidden border-t border-white/25 md:block"
      style={{ animation: "glass-rise 320ms var(--glass-ease) both" }}
    >
      <ul
        className={cn(
          // Centred on the bar and held to a max width: the panel is the same
          // surface as the wordmark above it, and centred text that runs the
          // full width of an ultrawide screen stops being a list you can scan.
          "mx-auto w-full px-8 py-8 text-center",
          // Sub-copy needs room to breathe, so those menus span the bar in
          // columns; a plain list stays a single narrow column.
          group.wide
            ? "grid max-w-5xl grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-3 lg:grid-cols-4"
            : "flex max-w-sm flex-col items-center gap-4"
        )}
      >
        {group.links.map((link, i) => {
          const start = reduced ? 0 : Math.min(i * STAGGER_MS, STAGGER_CAP_MS);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className="group/link inline-block cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--shop-ink)]"
              >
                <ScrambleText
                  text={link.label}
                  delay={start}
                  className="block text-[0.9375rem] text-[var(--shop-ink)] transition-opacity duration-200 group-hover/link:opacity-60"
                />
                {/* Sub-copy is the explanation, not the headline, so it waits
                    for its own label to land instead of competing with it. */}
                {link.note && (
                  <span
                    className="mt-1.5 block text-sm text-[var(--shop-mute)]"
                    style={{
                      animation: `glass-rise 240ms var(--glass-ease) ${
                        reduced ? 0 : scrambleDuration(link.label, start)
                      }ms both`,
                    }}
                  >
                    {link.note}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
