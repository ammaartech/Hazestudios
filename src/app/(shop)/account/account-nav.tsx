"use client";

import Link from "next/link";
import { Package, User, LifeBuoy, LayoutDashboard } from "lucide-react";

const LINKS = [
  { href: "/account", label: "Overview", icon: LayoutDashboard },
  { href: "/account/orders", label: "Orders", icon: Package },
  { href: "/account/profile", label: "Details", icon: User },
  { href: "/account/help", label: "Help", icon: LifeBuoy },
];

/**
 * The account area's segmented nav: one travelling glass highlight rather
 * than four backgrounds toggled on and off — the same technique as the
 * bottom `glass-indicator` in `glass-tab-bar.tsx`. A tap slides the highlight
 * to its new cell instead of snapping, which is what makes switching tabs
 * read as *moving* rather than *replacing*.
 *
 * Client-only for that animation: the links themselves are plain anchors and
 * would happily render on the server, but the sliding transform only means
 * anything once mounted in the browser, and keeping this component mounted
 * across a navigation (React reconciles it in place, since every account
 * page returns the same `AccountShell` → `AccountNav` at the same position)
 * is what lets the highlight glide instead of jumping.
 */
export function AccountNav({ current }: { current: string }) {
  const activeIndex = LINKS.findIndex((link) => link.href === current);

  return (
    <ul className="relative grid grid-cols-4 md:flex md:flex-col">
      {activeIndex >= 0 && (
        <>
          <span
            aria-hidden
            className="glass glass-on-light glass-indicator absolute inset-y-0 rounded-2xl md:hidden"
            style={{
              width: `calc(100% / ${LINKS.length})`,
              transform: `translateX(calc(100% * ${activeIndex}))`,
            }}
          />
          <span
            aria-hidden
            className="glass glass-on-light glass-indicator absolute inset-x-0 hidden rounded-full md:block"
            style={{
              height: `calc(100% / ${LINKS.length})`,
              transform: `translateY(calc(100% * ${activeIndex}))`,
            }}
          />
        </>
      )}

      {LINKS.map((link, i) => {
        const active = i === activeIndex;
        const Icon = link.icon;
        return (
          <li key={link.href} className="relative z-10">
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`glass-press flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-center text-[11px] font-medium transition-colors duration-300 md:min-h-11 md:w-full md:flex-row md:justify-start md:gap-2.5 md:rounded-full md:px-4 md:text-sm ${
                active
                  ? "text-(--shop-ink)"
                  : "text-(--shop-mute) hover:text-(--shop-ink)"
              }`}
            >
              <Icon className="size-4.5 md:size-4" aria-hidden />
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
