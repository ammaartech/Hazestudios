import Link from "next/link";
import { Lock } from "lucide-react";
import { getStoreName } from "@/lib/shop/queries";

/**
 * The checkout shell.
 *
 * Its own route group rather than a page inside `(shop)`, because the thing
 * checkout needs most is the removal of everything the storefront layout
 * provides: the nav, the mobile tab bar, the cart drawer, the footer sitemap.
 * Each is another way out of a flow the shopper has already decided to
 * complete, and a nested layout can add chrome but never take its parent's
 * away.
 *
 * What stays is the theme. `.shop` re-skins the shadcn tokens exactly as it
 * does on the storefront, so this reads as the same shop with the furniture
 * cleared — not as a third-party payment page, which is precisely the moment
 * shoppers abandon.
 */
export default async function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const storeName = await getStoreName();

  return (
    <div className="shop flex min-h-screen flex-col bg-(--shop-canvas) text-(--shop-ink)">
      <a
        href="#checkout"
        className="meta sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-(--shop-ink) focus:px-4 focus:py-3 focus:text-(--shop-canvas)"
      >
        Skip to content
      </a>

      <header className="border-b border-(--shop-hairline-soft)">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 md:px-8">
          {/* The only way out, and deliberately the store's own name: leaving
              checkout should feel like going back to the shop, not cancelling. */}
          <Link
            href="/cart"
            className="display cursor-pointer text-2xl tracking-[-0.03em] transition-opacity duration-200 hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--shop-ink) md:text-3xl"
          >
            {storeName}
          </Link>

          <p className="meta flex items-center gap-2 text-(--shop-mute)">
            <Lock className="size-3.5" strokeWidth={2} aria-hidden />
            Secure checkout
          </p>
        </div>
      </header>

      <main id="checkout" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-(--shop-hairline-soft) px-4 py-6 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p className="text-xs text-(--shop-stone)">
            © {new Date().getFullYear()} {storeName}
          </p>
          <nav aria-label="Policies" className="flex flex-wrap gap-x-6 gap-y-2">
            {[
              { href: "/account/help", label: "Help" },
              { href: "/", label: "Continue shopping" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="cursor-pointer text-xs text-(--shop-mute) transition-colors duration-200 hover:text-(--shop-ink)"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
