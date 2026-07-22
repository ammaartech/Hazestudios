import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Only the admin and the login screen need a session check. The storefront is
  // public, so it is deliberately excluded — running the Supabase auth round
  // trip on every shop request would slow it down for no benefit, and the old
  // catch-all matcher redirected every customer to /login.
  matcher: ["/admin/:path*", "/login"],
};
