import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / email-confirmation landing.
 *
 * Supabase sends the browser here with a one-time `code` after Google sign-in,
 * an email confirmation, or a password-reset link. Exchanging it sets the
 * session cookies, which is why this has to be a route handler rather than a
 * page — the cookie write must happen on a real response.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const errorDescription = searchParams.get("error_description");

  // Only ever bounce to a path on this site; `next` arrives from a URL the user
  // could have edited, and an absolute value would make this an open redirect.
  const requested = searchParams.get("next") ?? "/account";
  const next =
    requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/account";

  if (errorDescription) {
    const url = new URL("/account/login", origin);
    url.searchParams.set("error", errorDescription);
    return NextResponse.redirect(url);
  }

  if (!code) {
    return NextResponse.redirect(new URL("/account/login", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const url = new URL("/account/login", origin);
    url.searchParams.set(
      "error",
      "That sign-in link has expired or was already used. Request a new one."
    );
    return NextResponse.redirect(url);
  }

  // Claim or create the customer record now, so the account area is populated
  // on the very first page the shopper lands on. Safe to ignore failures: the
  // account pages call this too, and an unconfirmed email legitimately returns
  // null here.
  try {
    await supabase.rpc("link_customer_account");
  } catch {
    // Non-fatal — the account pages call this too.
  }

  return NextResponse.redirect(new URL(next, origin));
}
