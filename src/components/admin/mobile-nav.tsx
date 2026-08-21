"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  Home,
  Menu,
  Search,
  Settings,
  ShoppingCart,
  Tag,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { mainNav, salesChannelNav, type NavItem } from "./nav";
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
 * the taps start missing, so the fifth is the menu: everything else, in full.
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

/** True when the path is inside the section at all — the item or any child. */
function inSection(pathname: string, item: NavItem) {
  return (
    isActive(pathname, item.href) ||
    (item.children ?? []).some((c) => isActive(pathname, c.href))
  );
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
   * The route the menu was opened on, or null when it is closed.
   *
   * Storing the path rather than a boolean makes "close on navigate" fall out
   * of the data: the moment `pathname` changes the menu is no longer open for
   * the current route, so it closes with no effect to fire and no frame in
   * which it lingers over the new page. That covers the back gesture too, which
   * changes the path without unmounting this component.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const menuOpen = openedAt === pathname;
  const setMenuOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  // The menu is a layer over the page, so the page behind it must not scroll.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  const inMenu = !TABS.some((t) => isActive(pathname, t.href));

  return (
    <>
      {menuOpen && <NavMenu pathname={pathname} onClose={() => setMenuOpen(false)} />}

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
          {/*
            Three lines, not a grid of squares.

            The grid icon read as "apps" and the label said "More", which
            together promised a handful of extra shortcuts. What is behind it
            is the entire sidebar — every section and every one of its
            sub-pages — and a hamburger is the one icon that says that without
            a label, which is also what buys the slot back for a wider tap
            target.
          */}
          <TabButton
            icon={Menu}
            label="Menu"
            active={inMenu}
            expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
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
  expanded,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  active: boolean;
  expanded?: boolean;
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
    <button
      type="button"
      onClick={onClick}
      className={className}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={expanded}
    >
      {content}
    </button>
  );
}

/**
 * The whole navigation, as a full-screen sheet.
 *
 * It replaces a bottom sheet that listed every section *and* every child at
 * once — 30-odd rows, flat, with the sub-pages indented under parents that
 * looked identical to them. That is a scroll, not a menu: finding Metaobjects
 * meant reading past Collections, Inventory, Gift cards, Purchase orders,
 * Transfers and Price lists, none of which you were looking for.
 *
 * Collapsed instead, one disclosure per section. Eight rows fit on a phone
 * without scrolling, so the shape of the admin is legible at a glance and the
 * six sub-pages of Products are one tap away rather than six rows of noise.
 *
 * Full-screen rather than a partial sheet, because at this size a sheet that
 * covers four-fifths of the screen is only pretending the page behind it is
 * still in play. Committing to the whole viewport gives every row a full-width
 * target and the expanded section somewhere to go.
 */
function NavMenu({
  pathname,
  onClose,
}: {
  pathname: string;
  onClose: () => void;
}) {
  const items = [...mainNav, ...salesChannelNav];

  /**
   * Which section is expanded, or null for none.
   *
   * Seeded from the current route so the menu opens showing where you already
   * are — on `/admin/products/inventory` the Products group is open with
   * Inventory marked, which is the same orientation the desktop sidebar gives.
   *
   * One at a time. An accordion that allows several open sections turns back
   * into the flat list this replaced the first time someone taps three of them.
   */
  const [open, setOpen] = useState<string | null>(
    () => items.find((i) => i.children?.length && inSection(pathname, i))?.href ?? null
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Navigation"
      className="fixed inset-0 z-50 flex flex-col bg-popover md:hidden"
      style={{ animation: "admin-sheet-in 240ms cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-[15px] font-semibold">Menu</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="-mr-2 flex size-10 cursor-pointer items-center justify-center rounded-full text-muted-foreground active:bg-muted"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* `pb-32` clears the island, which stays on screen underneath. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-32">
        <button
          type="button"
          onClick={() => {
            onClose();
            openAdminSearch();
          }}
          className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-[15px] active:bg-muted"
        >
          <Search className="size-[18px] text-muted-foreground" aria-hidden />
          Search the admin
        </button>

        {items.map((item) => (
          <NavRow
            key={item.href}
            item={item}
            pathname={pathname}
            open={open === item.href}
            onToggle={() => setOpen((o) => (o === item.href ? null : item.href))}
          />
        ))}

        <NavRow
          item={{ label: "Settings", href: "/admin/settings", icon: Settings }}
          pathname={pathname}
          open={false}
          onToggle={() => {}}
        />
      </div>
    </div>
  );
}

/**
 * One section: a link to the section itself, plus a disclosure for its pages.
 *
 * The two are separate targets on purpose. Tapping "Orders" goes to Orders —
 * making the whole row a toggle would mean the section you most want is the
 * one row you cannot reach — and tapping the chevron beside it opens the six
 * pages underneath without leaving the menu.
 */
function NavRow({
  item,
  pathname,
  open,
  onToggle,
}: {
  item: NavItem;
  pathname: string;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = item.icon;
  const active = isActive(pathname, item.href);
  const children = item.children ?? [];
  const panelId = `nav-${item.href.replace(/\W+/g, "-")}`;

  return (
    <div>
      <div
        className={cn(
          "flex items-center rounded-xl",
          active && !open && "bg-sidebar-selected"
        )}
      >
        <Link
          href={item.href}
          className={cn(
            "flex min-h-12 flex-1 items-center gap-3 rounded-xl px-3 text-[15px] active:bg-muted",
            active && "font-medium"
          )}
          aria-current={active ? "page" : undefined}
        >
          <Icon
            className={cn(
              "size-[18px] shrink-0",
              active ? "text-foreground" : "text-muted-foreground"
            )}
            aria-hidden
          />
          {item.label}
        </Link>

        {children.length > 0 && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? "Hide" : "Show"} ${item.label} pages`}
            className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground active:bg-muted"
          >
            <ChevronDown
              className={cn(
                "size-[18px] transition-transform duration-200",
                open && "rotate-180"
              )}
            />
          </button>
        )}
      </div>

      {open && children.length > 0 && (
        <div id={panelId} className="mb-1 pb-1">
          {children.map((child) => {
            const on = isActive(pathname, child.href);
            return (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  // The 12px rule under the parent's icon is what ties the
                  // children to it — indentation alone reads as a smaller row
                  // rather than a nested one.
                  "ml-[1.4rem] flex min-h-11 items-center border-l pl-4 pr-3 text-[14px] text-muted-foreground active:bg-muted",
                  on && "border-foreground font-medium text-foreground"
                )}
                aria-current={on ? "page" : undefined}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Reads the live path. Must be rendered inside a Suspense boundary. */
export function MobileNav() {
  return <MobileNavBar pathname={usePathname()} />;
}
