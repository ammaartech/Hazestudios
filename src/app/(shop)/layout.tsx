import { Suspense } from "react";
import { AnnouncementBar } from "@/components/shop/announcement-bar";
import { ShopHeader, ShopHeaderView } from "@/components/shop/header";
import { ShopFooter } from "@/components/shop/footer";
import { AnalyticsTracker } from "@/components/shop/analytics-tracker";
import { GlassTabBar, GlassTabBarView } from "@/components/shop/glass-tab-bar";
import { CartProvider } from "@/components/shop/cart-provider";
import { CartDrawer } from "@/components/shop/cart-drawer";
import { RevealObserver } from "@/components/shop/reveal-observer";
import { getCollections, getStoreName } from "@/lib/shop/queries";

/**
 * Storefront shell. The `.shop` class swaps the shadcn token values over to the
 * editorial palette for this subtree only — see the `.shop` block in globals.css.
 *
 * Everything this component awaits is catalogue data: the store's name and its
 * published collections, identical for every visitor and cached. That is what
 * lets the shell be prerendered into static HTML and served without touching
 * Postgres or React on the way.
 *
 * The bag used to be resolved here too, and it was the single reason no
 * storefront route could ever be static — one `cookies()` read in the layout
 * makes the whole route per-request, however cacheable the page below it is.
 * `CartProvider` now fetches it from the browser after hydration instead; see
 * the mount effect in `cart-provider.tsx` for why that trade is worth making.
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
    <CartProvider>
      {/* `dvh`, not `vh`: on mobile Safari and Chrome `100vh` is the height with
          the URL bar hidden, so a `vh`-sized shell is taller than the screen on
          load and the page starts with a scroll it did not ask for. */}
      <div className="shop flex min-h-dvh flex-col bg-[var(--shop-canvas)] text-[var(--shop-ink)]">
        <a
          href="#main"
          className="meta sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[var(--shop-ink)] focus:px-4 focus:py-3 focus:text-[var(--shop-canvas)]"
        >
          Skip to content
        </a>
        {/*
          The chrome below reads the current path to mark what is current. On
          every product and collection page that path is known while the shell
          is built — `generateStaticParams` enumerates them — so these resolve
          during the prerender and the real header lands in the static HTML.
          The boundaries exist for the routes that cannot be enumerated, like
          `/orders/[token]`, where the path only exists at request time; there
          the fallbacks below hold the layout and the live versions stream in.

          A `<Suspense>` does not by itself make anything dynamic — it only
          declares what to show if the content cannot finish during the
          prerender. Wrapping these costs the common case nothing.
        */}
        <Suspense fallback={null}>
          <AnalyticsTracker />
        </Suspense>
        {/* Arms every `data-reveal` in the subtree from one observer. Mounted
            inside `.shop` because that is the root it looks for, and before the
            content so it is observing by the time the first section commits. */}
        <RevealObserver />
        {/* Above the sticky header, so the offers scroll away with the page
            rather than permanently spending a strip of every screen. */}
        <AnnouncementBar />
        <Suspense
          fallback={
            <ShopHeaderView
              storeName={storeName}
              collections={collections}
              pathname=""
            />
          }
        >
          <ShopHeader storeName={storeName} collections={collections} />
        </Suspense>
        <main id="main" className="flex-1">
          {children}
        </main>
        <ShopFooter storeName={storeName} />
        {/* Mobile navigation. Rendered after the footer so it is last in the tab
            order, and the footer carries matching bottom padding so the floating
            bar never covers the final row of links. */}
        <Suspense
          fallback={<GlassTabBarView collections={collections} pathname="" />}
        >
          <GlassTabBar collections={collections} />
        </Suspense>
        {/* Closed on arrival either way, so there is nothing to stand in for. */}
        <Suspense fallback={null}>
          <CartDrawer />
        </Suspense>
      </div>
    </CartProvider>
  );
}
