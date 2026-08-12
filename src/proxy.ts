import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  /*
    The admin, the staff login, and — while the shop is in testing — the
    storefront too, so `@/lib/shop/preview-lock` can hold the door. That lock is
    temporary; when it goes, this should shrink back to
    `["/admin/:path*", "/login"]` so the public storefront stops paying for a
    Supabase auth round trip it does not need.

    Three exclusions, each for a concrete reason:

      * `api` — `/api/webhooks/cashfree` is called server-to-server by the
        gateway with no cookie of ours. Walling it would silently break payment
        confirmation, which is the worst possible thing to break quietly. The
        other handlers already do their own authorisation, and none of them were
        matched before this change either.
      * `_next/` — the build output. Redirecting a stylesheet to a login page is
        how a "locked" site ends up rendering unstyled for the people who *are*
        allowed in.
      * an explicit list of static extensions, for everything under `public/`
        (the waitlist art, the brand marks, the fonts).

    That last exclusion is a list rather than the usual `.*\\.[^/]+$` "anything
    with a dot" pattern, because the loose version is a hole: a product handle
    that happens to contain a dot — `/products/tee-v2.0` — would look like a
    file to the regex and skip the gate entirely. Naming the extensions we
    actually serve means a route can never accidentally qualify.
  */
  matcher: [
    "/((?!api/|_next/|.*\\.(?:ico|png|jpg|jpeg|gif|webp|avif|svg|css|js|mjs|map|json|txt|xml|woff|woff2|ttf|otf|mp4|webm)$).*)",
  ],
};
