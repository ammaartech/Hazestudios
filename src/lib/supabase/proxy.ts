import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_LOCK, isOpenDuringPreview } from "@/lib/shop/preview-lock";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

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
      const { data: isStaff } = await supabase.rpc("is_staff");

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
   * Note what this costs: matching the storefront means a Supabase auth
   * round trip on every shop request, which the matcher in `src/proxy.ts`
   * previously existed to avoid. That is an acceptable price on a site
   * nobody is allowed into yet, and it goes away with the lock.
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
