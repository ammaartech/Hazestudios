import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchRemote } from "@/lib/search/remote";

/**
 * The remote tier of admin search: orders, customers and variant SKUs.
 *
 * A GET Route Handler rather than a Server Action, which is the natural reach
 * for a mutation-free lookup in this codebase (see `orders/new/search-actions.ts`)
 * but is the wrong tool for search-as-you-type. Next runs Server Actions
 * **sequentially** — each one may revalidate the router cache, so they queue
 * behind one another. Typing eight characters would enqueue eight actions that
 * drain in order, and the answer to "stussy" would arrive after the answer to
 * "stuss" no matter which the server finished first. A plain GET is
 * independently dispatched, so the client can fire and, more importantly,
 * *abort* one per keystroke via `AbortController` and only ever have the
 * current query in flight.
 *
 * Not cached, deliberately. `q` is unbounded, so a cache keyed on it would be a
 * cache with no hit rate, and the underlying rows change constantly. The
 * freshness that matters here is the browser dropping a superseded request,
 * which the client owns.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // RLS is `to authenticated`, so an anonymous caller would get an empty list
  // rather than a refusal. Saying 401 lets the dropdown distinguish "signed
  // out" from "no matches", which are very different things to render.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const results = await searchRemote(supabase, q);

  return NextResponse.json(
    { results },
    { headers: { "Cache-Control": "no-store" } }
  );
}
