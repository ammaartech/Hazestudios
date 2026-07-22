import Link from "next/link";
import type { Collection } from "@/lib/types";

export function ShopFooter({
  storeName,
  collections,
}: {
  storeName: string;
  collections: Collection[];
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 border-t border-[var(--shop-hairline-soft)] bg-[var(--shop-canvas)]">
      <div className="px-4 py-16 md:px-8">
        <div className="grid gap-12 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <p className="display text-4xl text-[var(--shop-ink)] md:text-5xl">
              {storeName}
            </p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--shop-mute)]">
              Ready-to-wear produced in limited runs. Each drop is cut once and
              not repeated.
            </p>
          </div>

          <nav aria-label="Shop">
            <h2 className="meta text-[var(--shop-stone)]">Shop</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {collections.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/collections/${c.handle}`}
                    className="cursor-pointer text-sm text-[var(--shop-charcoal)] transition-colors duration-200 hover:text-[var(--shop-ink)]"
                  >
                    {c.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Information">
            <h2 className="meta text-[var(--shop-stone)]">Information</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {["Shipping", "Returns", "Sizing", "Contact"].map((label) => (
                <li key={label}>
                  <span className="text-sm text-[var(--shop-stone)]">{label}</span>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <p className="mt-16 border-t border-[var(--shop-hairline-soft)] pt-6 text-xs text-[var(--shop-stone)]">
          © {year} {storeName}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
