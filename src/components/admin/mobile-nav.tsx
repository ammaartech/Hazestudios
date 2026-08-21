"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  LayoutGrid,
  Search,
  Settings,
  ShoppingCart,
  Tag,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { mainNav, salesChannelNav } from "./nav";
import { openAdminSearch } from "@/lib/search/open-search";
import { cn } from "@/lib/utils";

/**
 * The admin's mobile navigation — a floating island above the bottom edge.
 *
 * Until now the admin had no mobile navigation at all: the sidebar is
 * `hidden md:flex` and the topbar search is `hidden md:block`, so on a phone
 * the whole app was a brand mark and an avatar menu. Every route was reachable
 * only by typing its URL.
 *
 * An island rather than a full-width tab bar, and the reasons are practical
 * rather than stylistic. It is reachable: on a 6.7" phone the top of the screen
 * needs a second hand, and the four destinations an operator actually uses all
 * day belong under the thumb. It floats clear of the bottom edge so it never
 * collides with the iOS home indicator or Android's gesture pill, and the
 * rounded shape reads as a control laid *over* the page rather than a piece of
 * chrome the page has to end above — which matters when the page underneath is
 * a long scrolling table.
 *
 * Five slots is the ceiling. Below ~64px per target the labels stop fitting and
 * the taps start missing, so the fifth is "More": everything else, in a sheet.
 */

interface Tab {
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * The four destinations that carry daily work, in the order an operator moves
 * through them. Deliberately not derived from `mainNav` — that list is a
 * complete site map, and a bottom bar is a shortlist. Discounts, Content and
 * Marketing are real destinations that simply do not belong under a thumb.
 */
const TABS: Tab[] = [
  { label: "Home", href: "/admin", icon: Home },
  { label: "Orders", href: "/admin/orders", icon: ShoppingCart },
  { label: "Products", href: "/admin/products", icon: Tag },
  { label: "Customers", href: "/admin/customers", icon: Users },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The island itself, as a pure function of the current path.
 *
 * Split the same way `SidebarNav` is, and for the same reason: `usePathname` is
 * request-time data, and under Cache Components a component that reads it
 * cannot appear in a static shell — it fails the prerender outright rather than
 * quietly deopting. Taking the path as a prop lets the admin layout render this
 * as its Suspense fallback with an empty path: identical island, identical
 * height, nothing marked active, so the highlight resolves without the bar
 * moving.
 */
export function MobileNavBar({ pathname }: { pathname: string }) {
  /**
   * The route the sheet was opened on, or null when it is closed.
   *
   * Storing the path rather than a boolean makes "close on navigate" fall out
   * of the data: the moment `pathname` changes the sheet is no longer open for
   * the current route, so it closes with no effect to fire and no frame in
   * which it lingers over the new page. That covers the back gesture too, which
   * changes the path without unmounting this component.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const moreOpen = openedAt === pathname;
  const setMoreOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  // The sheet is a layer over the page, so the page behind it must not scroll.
  useEffect(() => {
    if (!moreOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [moreOpen]);

  const inMore = !TABS.some((t) => isActive(pathname, t.href));

  return (
    <>
      {moreOpen && <MoreSheet pathname={pathname} onClose={() => setMoreOpen(false)} />}

      <nav
        aria-label="Primary"
        /*
          `pb-[env(safe-area-inset-bottom)]` on the wrapper rather than the
          island: the inset is the height of the home indicator, and the island
          needs to sit above it with its own margin intact, not absorb it as
          padding and end up visually squashed against the glass.

          `pointer-events-none` on the wrapper with `auto` on the island keeps
          the strip either side of the pill transparent to touch, so a tap
          aimed at the page's last row does not get eaten by the nav's bounding
          box.
        */
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="glass-floating pointer-events-auto mb-3 flex items-center gap-0.5 rounded-full p-1.5 shadow-lg">
          {TABS.map((tab) => (
            <TabButton
              key={tab.href}
              icon={tab.icon}
              label={tab.label}
              href={tab.href}
              active={isActive(pathname, tab.href)}
            />
          ))}
          <TabButton
            icon={LayoutGrid}
            label="More"
            active={inMore}
            onClick={() => setMoreOpen(true)}
          />
        </div>
      </nav>
    </>
  );
}

/**
 * One island slot.
 *
 * The active state is a filled pill that reveals the label; inactive slots are
 * icon-only. That keeps five targets inside a 360px screen without shrinking
 * any of them below the 44px Apple and Android both ask for, and it means the
 * island always says in words where you are — an icon-only bar makes you decode
 * a glyph to answer that.
 */
function TabButton({
  icon: Icon,
  label,
  href,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  active: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <Icon className="size-[18px] shrink-0" strokeWidth={2.1} aria-hidden />
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap text-[13px] font-medium transition-all duration-200",
          active ? "ml-1.5 max-w-24 opacity-100" : "ml-0 max-w-0 opacity-0"
        )}
      >
        {label}
      </span>
    </>
  );

  const className = cn(
    "flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-full px-3.5 transition-colors duration-200",
    active
      ? "bg-primary text-primary-foreground"
      : "text-muted-foreground active:bg-sidebar-hover"
  );

  if (href) {
    return (
      <Link
        href={href}
        className={className}
        aria-current={active ? "page" : undefined}
        // Icon-only slots have no visible text to announce.
        aria-label={active ? undefined : label}
      >
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className} aria-label={label}>
      {content}
    </button>
  );
}

/**
 * Everything the island has no room for.
 *
 * A bottom sheet rather than a full-screen page, because it is a menu and not a
 * destination — the page behind stays visible, so dismissing it returns you
 * exactly where you were rather than feeling like a back-navigation.
 */
function MoreSheet({
  pathname,
  onClose,
}: {
  pathname: string;
  onClose: () => void;
}) {
  const items = [...mainNav, ...salesChannelNav];

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/35 backdrop-blur-[2px]"
        style={{ animation: "admin-sheet-scrim 200ms ease-out" }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="All sections"
        className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t bg-popover pb-[max(1rem,env(safe-area-inset-bottom))]"
        style={{ animation: "admin-sheet-in 260ms cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {/* Grab handle — the affordance that says this panel is dismissible. */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-popover px-4 pb-3 pt-3">
          <span className="mx-auto absolute inset-x-0 top-1.5 h-1 w-9 rounded-full bg-border" />
          <h2 className="mt-2 text-[15px] font-semibold">All sections</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mt-2 flex size-9 cursor-pointer items-center justify-center rounded-full text-muted-foreground active:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              openAdminSearch();
            }}
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] active:bg-muted"
          >
            <Search className="size-[18px] text-muted-foreground" aria-hidden />
            Search the admin
          </button>

          {items.map((item) => {
            const Icon = item.icon;
            const on = isActive(pathname, item.href);
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] active:bg-muted",
                    on && "bg-sidebar-selected font-medium"
                  )}
                  aria-current={on ? "page" : undefined}
                >
                  <Icon className="size-[18px] text-muted-foreground" aria-hidden />
                  {item.label}
                </Link>
                {item.children?.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    className={cn(
                      "flex items-center rounded-xl py-2.5 pl-12 pr-3 text-[14px] text-muted-foreground active:bg-muted",
                      isActive(pathname, child.href) && "font-medium text-foreground"
                    )}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            );
          })}

          <Link
            href="/admin/settings"
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] active:bg-muted",
              pathname.startsWith("/admin/settings") && "bg-sidebar-selected font-medium"
            )}
          >
            <Settings className="size-[18px] text-muted-foreground" aria-hidden />
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Reads the live path. Must be rendered inside a Suspense boundary. */
export function MobileNav() {
  return <MobileNavBar pathname={usePathname()} />;
}
