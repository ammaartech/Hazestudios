"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import type { Collection } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Minimal chrome: a hairline-separated bar that stays out of the photography's
 * way. Collection links are driven by real collections so the nav can't drift
 * from the catalog.
 */
export function ShopHeader({
  storeName,
  collections,
}: {
  storeName: string;
  collections: Collection[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Prevent the page behind the drawer from scrolling while it's open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const links = collections.map((c) => ({
    label: c.title,
    href: `/collections/${c.handle}`,
  }));

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--shop-hairline-soft)] bg-[var(--shop-canvas)]">
      <div className="flex h-14 items-center gap-6 px-4 md:h-16 md:px-8">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="-ml-2 flex size-11 cursor-pointer items-center justify-center md:hidden"
        >
          <Menu className="size-5" aria-hidden />
        </button>

        <Link
          href="/"
          className="display shrink-0 text-lg tracking-[-0.02em] text-[var(--shop-ink)] md:text-xl"
        >
          {storeName}
        </Link>

        <nav aria-label="Collections" className="ml-4 hidden md:block">
          <ul className="flex items-center gap-7">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "meta cursor-pointer border-b-2 py-1 transition-colors duration-200",
                      active
                        ? "border-[var(--shop-ink)] text-[var(--shop-ink)]"
                        : "border-transparent text-[var(--shop-mute)] hover:text-[var(--shop-ink)]"
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {/* Cart lands in the next pass; the affordance is here so the header
              layout is final and the count has a reserved slot. */}
          <Link
            href="/cart"
            className="meta flex h-11 cursor-pointer items-center px-3 text-[var(--shop-ink)] transition-opacity duration-200 hover:opacity-60"
          >
            Cart (0)
          </Link>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-[var(--shop-ink)]/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col bg-[var(--shop-canvas)]">
            <div className="flex h-14 items-center justify-between border-b border-[var(--shop-hairline-soft)] px-4">
              <span className="display text-lg text-[var(--shop-ink)]">{storeName}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="-mr-2 flex size-11 cursor-pointer items-center justify-center"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <nav aria-label="Collections" className="flex-1 overflow-y-auto p-4">
              <ul className="flex flex-col">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className="display flex min-h-14 items-center py-2 text-3xl text-[var(--shop-ink)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
