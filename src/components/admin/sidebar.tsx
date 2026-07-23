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
            ? "bg-white/[0.07] font-medium text-white"
            : sectionOn
              ? "text-white hover:bg-white/[0.05]"
              : "text-sidebar-foreground hover:bg-white/[0.05] hover:text-white"
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0 transition-colors duration-150",
            sectionOn
              ? "text-sidebar-primary"
              : "text-sidebar-foreground group-hover/nav:text-white"
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
                    ? "font-medium text-white"
                    : "text-sidebar-foreground hover:bg-white/[0.04] hover:text-white"
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

export function Sidebar() {
  const pathname = usePathname();

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
              ? "bg-white/[0.07] font-medium text-white"
              : "text-sidebar-foreground hover:bg-white/[0.05] hover:text-white"
          )}
        >
          <Settings
            className={cn(
              "size-4 shrink-0 transition-colors duration-150",
              pathname.startsWith("/admin/settings")
                ? "text-sidebar-primary"
                : "text-sidebar-foreground group-hover/nav:text-white"
            )}
            strokeWidth={2}
          />
          Settings
        </Link>
      </div>
    </aside>
  );
}
