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
  const active = sectionActive(pathname, item);
  const Icon = item.icon;

  return (
    <div>
      <Link
        href={item.href}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
          active && isActive(pathname, item.href) && !item.children?.some((c) => isActive(pathname, c.href))
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className="size-4 shrink-0" />
        {item.label}
      </Link>
      {item.children && active && (
        <div className="mt-0.5 mb-1 space-y-0.5">
          {item.children.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              className={cn(
                "block rounded-md py-1 pl-9 pr-2.5 text-[13px] transition-colors duration-150",
                isActive(pathname, child.href)
                  ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 top-14 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {mainNav.map((item) => (
          <NavEntry key={item.href} item={item} pathname={pathname} />
        ))}

        <p className="px-2.5 pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sales channels
        </p>
        {salesChannelNav.map((item) => (
          <NavEntry key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <Link
          href="/admin/settings/general"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
            pathname.startsWith("/admin/settings")
              ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          )}
        >
          <Settings className="size-4" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
