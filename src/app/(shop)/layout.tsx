import { ShopHeader } from "@/components/shop/header";
import { ShopFooter } from "@/components/shop/footer";
import { getCollections, getStoreName } from "@/lib/shop/queries";

/**
 * Storefront shell. The `.shop` class swaps the shadcn token values over to the
 * editorial palette for this subtree only — see the `.shop` block in globals.css.
 */
export default async function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [storeName, collections] = await Promise.all([
    getStoreName(),
    getCollections(),
  ]);

  return (
    <div className="shop flex min-h-screen flex-col bg-[var(--shop-canvas)] text-[var(--shop-ink)]">
      <a
        href="#main"
        className="meta sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[var(--shop-ink)] focus:px-4 focus:py-3 focus:text-[var(--shop-canvas)]"
      >
        Skip to content
      </a>
      <ShopHeader storeName={storeName} collections={collections} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <ShopFooter storeName={storeName} collections={collections} />
    </div>
  );
}
