import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_LOCK, isOpenDuringPreview } from "@/lib/shop/preview-lock";
import { staffFromClaims } from "@/lib/auth/claims";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Allow browsing the UI before Supabase is configured (.env.local missing).
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const path = request.nextUrl.pathname;
  const isAdminRoute = path === "/admin" || path.startsWith("/admin/");
  const isStaffLogin = path.startsWith("/login");

  /*
    `getClaims()` rather than `getUser()`.

    This ran on every admin request — and on every one of the hundred-odd
    link prefetches a page view triggers — and `getUser()` is a round trip to
    the Auth server in Tokyo (~150–300 ms from India) each time. The project
    signs its tokens with ES256 and publishes the public key at
    `/.well-known/jwks.json`, so the signature can be checked here, locally;
    the key set is cached in-process for ten minutes. An expired token still
    goes to the network, because `getClaims` reads the session first and
    refreshes it when it has lapsed, which is also what keeps the cookies
    fresh. What is given up is revocation: a signed-out-elsewhere session
    stays valid until its token expires (an hour). RLS is the actual boundary
    behind this gate, so that is an acceptable trade.
  */
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  let claims: Parameters<typeof staffFromClaims>[0] = claimsData?.claims ?? null;
  if (!claims && claimsError) {
    // Local verification failed for a reason other than "no session" — the
    // key set could not be fetched, say. Ask the Auth server rather than
    // logging a working session out over a blip.
    const {
      data: { user: verified },
    } = await supabase.auth.getUser();
    if (verified) {
      claims = { sub: verified.id, email: verified.email, app_metadata: verified.app_metadata };
    }
  }
  const user = claims ? { id: claims.sub } : null;

  /* ------------------------------------------------------------------ *
   * The admin, and the staff login that leads to it.
   * ------------------------------------------------------------------ */
  if (isAdminRoute || isStaffLogin) {
    if (!user && !isStaffLogin) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    if (user) {
      // Being signed in is not the same as being staff. Shoppers authenticate
      // against the same Supabase project, so without this check every customer
      // account would reach the admin shell. RLS would still refuse them the
      // data, but they would land on a broken, empty admin — and the boundary
      // belongs at the route, not only at the table.
      //
      // Staff status rides in the token's `app_metadata`, stamped by a trigger
      // on staff_roles (0032). The RPC is only the fallback for a token minted
      // before that claim existed — a shopper, or a staff session from before
      // the migration that has not refreshed yet.
      let isStaff = staffFromClaims(claims).isStaff;
      if (!isStaff) {
        const { data } = await supabase.rpc("is_staff");
        isStaff = Boolean(data);
      }

      if (!isStaff) {
        const url = request.nextUrl.clone();
        // Send them where they actually have an account, rather than looping
        // them through a login screen they have already satisfied.
        url.pathname = "/account";
        url.search = "";
        url.searchParams.set("notice", "staff-only");
        return NextResponse.redirect(url);
      }

      if (isStaffLogin) {
        const url = request.nextUrl.clone();
        url.pathname = "/admin";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }

    return supabaseResponse;
  }

  /* ------------------------------------------------------------------ *
   * The storefront, while the shop is still being built.
   * ------------------------------------------------------------------ *
   * TEMPORARY. See `@/lib/shop/preview-lock` for what this is and how to
   * take it out. `/waitlist` and the auth screens are exempt; everything
   * else on the storefront needs an account until launch.
   *
   * With the token verified locally this is no longer a Supabase round trip
   * per storefront request, only a signature check — but the matcher in
   * `src/proxy.ts` should still shrink back to the admin when the lock goes.
   */
  if (PREVIEW_LOCK && !user && !isOpenDuringPreview(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/account/login";
    url.search = "";
    // Come back to where they were aiming once they are in.
    url.searchParams.set("next", `${path}${request.nextUrl.search}`);
    url.searchParams.set("notice", "preview");
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
