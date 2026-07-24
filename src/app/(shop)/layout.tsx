import { ShopHeader } from "@/components/shop/header";
import { ShopFooter } from "@/components/shop/footer";
import { AnalyticsTracker } from "@/components/shop/analytics-tracker";
import { GlassTabBar } from "@/components/shop/glass-tab-bar";
import { CartProvider } from "@/components/shop/cart-provider";
import { CartDrawer } from "@/components/shop/cart-drawer";
import { getCollections, getStoreName } from "@/lib/shop/queries";
import { getCart } from "@/lib/shop/cart";

/**
 * Storefront shell. The `.shop` class swaps the shadcn token values over to the
 * editorial palette for this subtree only — see the `.shop` block in globals.css.
 *
 * The cart is resolved here rather than per-page because the header badge and
 * the tab bar both need it on every route. It seeds the cart context once per
 * full page load; from then on the context is kept current by the values the
 * cart actions return, so nothing re-runs this query on a quantity change.
 */
export default async function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [storeName, collections, cart] = await Promise.all([
    getStoreName(),
    getCollections(),
    getCart(),
  ]);

  return (
    <CartProvider seed={cart}>
      <div className="shop flex min-h-screen flex-col bg-[var(--shop-canvas)] text-[var(--shop-ink)]">
        <a
          href="#main"
          className="meta sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[var(--shop-ink)] focus:px-4 focus:py-3 focus:text-[var(--shop-canvas)]"
        >
          Skip to content
        </a>
        <AnalyticsTracker />
        <ShopHeader storeName={storeName} collections={collections} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <ShopFooter storeName={storeName} collections={collections} />
        {/* Mobile navigation. Rendered after the footer so it is last in the tab
            order, and the footer carries matching bottom padding so the floating
            bar never covers the final row of links. */}
        <GlassTabBar collections={collections} />
        <CartDrawer />
      </div>
    </CartProvider>
  );
}
