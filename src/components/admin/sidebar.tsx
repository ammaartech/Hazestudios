"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { mainNav, salesChannelNav, type NavItem } from "./nav";

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

function sectionActive(pathname: string, item: NavItem) {
  if (isActive(pathname, item.href)) return true;
  return (item.children ?? []).some((c) => isActive(pathname, c.href));
}

function NavEntry({ item, pathname }: { item: NavItem; pathname: string }) {
  const sectionOn = sectionActive(pathname, item);
  const parentExact = isActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <div>
      <Link
        href={item.href}
        aria-current={parentExact ? "page" : undefined}
        className={cn(
          "group/nav flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-150",
          parentExact
            ? "bg-sidebar-selected font-medium text-sidebar-accent-foreground"
            : sectionOn
              ? "text-sidebar-accent-foreground hover:bg-sidebar-hover"
              : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0 transition-colors duration-150",
            sectionOn
              ? "text-sidebar-primary"
              : "text-sidebar-foreground group-hover/nav:text-sidebar-accent-foreground"
          )}
          strokeWidth={2}
        />
        {item.label}
      </Link>

      {item.children && sectionOn && (
        <div className="mt-0.5 mb-1 space-y-0.5">
          {item.children.map((child) => {
            const childOn = isActive(pathname, child.href);
            return (
              <Link
                key={child.href}
                href={child.href}
                aria-current={childOn ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg py-1.5 pl-9 pr-2.5 text-[13px] transition-colors duration-150",
                  childOn
                    ? "font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full transition-colors duration-150",
                    childOn ? "bg-sidebar-primary" : "bg-transparent"
                  )}
                />
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The sidebar's markup, given a path.
 *
 * Split from `Sidebar` so the nav can be rendered without knowing the current
 * URL. Under Partial Prerendering the pathname is request-time data — on a
 * dynamic route like `/admin/products/[id]` there is no single path to bake in
 * — so `Sidebar` cannot appear in a static shell. Passing an empty pathname
 * renders the identical nav with nothing marked active, which is what the
 * Suspense fallback in the admin layout uses: same width, same rows, same
 * height, so the highlight resolves without moving anything.
 */
export function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 top-14 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {mainNav.map((item) => (
          <NavEntry key={item.href} item={item} pathname={pathname} />
        ))}

        <p className="px-2.5 pb-1.5 pt-6 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground">
          Sales channels
        </p>
        {salesChannelNav.map((item) => (
          <NavEntry key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <Link
          href="/admin/settings/general"
          aria-current={pathname.startsWith("/admin/settings") ? "page" : undefined}
          className={cn(
            "group/nav flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-150",
            pathname.startsWith("/admin/settings")
              ? "bg-sidebar-selected font-medium text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground"
          )}
        >
          <Settings
            className={cn(
              "size-4 shrink-0 transition-colors duration-150",
              pathname.startsWith("/admin/settings")
                ? "text-sidebar-primary"
                : "text-sidebar-foreground group-hover/nav:text-sidebar-accent-foreground"
            )}
            strokeWidth={2}
          />
          Settings
        </Link>
      </div>
    </aside>
  );
}

export function Sidebar() {
  return <SidebarNav pathname={usePathname()} />;
}
