import Link from "next/link";

/**
 * The application's 404 — the one Next reaches for when a URL matches no route
 * at all, and the backstop for any `notFound()` thrown outside a route group.
 *
 * This file has to exist, and its absence was a real bug rather than a missing
 * nicety. Without a root `not-found`, Next falls back to its own built-in 404,
 * which renders *outside* the route groups — so `/login` and `/waitlist`, which
 * live at the app root rather than inside `(shop)` or `(admin)`, served their
 * own page with the framework's bare 404 painted over the top. The login form
 * was in the HTML the whole time, underneath it.
 *
 * `(shop)/not-found.tsx` does not cover those: a group's not-found only catches
 * routes inside that group.
 *
 * Deliberately self-contained. There are two root layouts here — `(admin)` and
 * `(shop)` — and this renders inside neither, so there is no nav to inherit and
 * no shop chrome to borrow. It leans only on what `app/layout.tsx` guarantees:
 * the font variables and the theme tokens from globals.css. Importing a shop
 * component here would pull a layout's worth of context into a page that has
 * none.
 *
 * Static on purpose: no data, nothing awaited, so it prerenders and costs
 * nothing to serve.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="font-(family-name:--font-subheading) text-xs uppercase tracking-[0.2em] text-muted-foreground">
        404
      </p>

      <h1 className="mt-5 font-(family-name:--font-display) text-[clamp(1.75rem,5vw,3rem)] leading-tight text-foreground">
        This page could not be found
      </h1>

      <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
        The link may be out of date, or the page may have been renamed.
      </p>

      <Link
        href="/"
        className="mt-10 cursor-pointer border-b border-foreground pb-1 font-(family-name:--font-subheading) text-xs uppercase tracking-[0.2em] text-foreground transition-opacity duration-200 hover:opacity-60"
      >
        Back to the shop
      </Link>
    </main>
  );
}
