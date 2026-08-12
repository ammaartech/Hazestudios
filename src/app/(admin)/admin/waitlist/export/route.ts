import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { WaitlistEntry } from "@/lib/types";
import { applyFilters, readFilters, toCsv } from "../query";

/**
 * GET /admin/waitlist/export — the whole waitlist as a CSV download.
 *
 * A route handler rather than a click-handler that serialises rows already on
 * the page, which is what the reports screen does. Two reasons, and both matter
 * more here than there:
 *
 *   * The page shows fifty rows at a time. An export that only covers the
 *     current page is worse than no export, because it looks like it worked.
 *     This walks the entire result set.
 *   * Every row is somebody's email address and phone number. Building the file
 *     on the server means the payload leaves the database once, when an
 *     operator actually asks for it, instead of being embedded in the HTML of a
 *     page they merely visited.
 *
 * Reads through the request-scoped client, so the `is_staff()` policies from
 * 0024_waitlist.sql apply. The `/admin/:path*` matcher in `src/proxy.ts` has
 * already turned away non-staff before this runs; the RLS check is the second
 * lock, not the first.
 */

/** PostgREST will not return more than a thousand rows in one response. */
const CHUNK = 1000;

/**
 * A stop, so a bug upstream cannot turn a download into an unbounded scan.
 * Twenty thousand is far beyond any plausible size for a twenty-seat event and
 * still a file a spreadsheet opens without complaint.
 */
const MAX_ROWS = 20_000;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const filters = readFilters({
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
  });

  const supabase = await createClient();

  const rows: WaitlistEntry[] = [];
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    const { data, error } = await applyFilters(
      supabase
        .from("waitlist_entries")
        .select("*")
        .order("position", { ascending: true }),
      filters
    ).range(from, from + CHUNK - 1);

    if (error) {
      // Deliberately terse. The operator gets a readable failure; the detail
      // goes to the server log rather than into a downloaded file.
      console.error("[waitlist/export]", error);
      return new NextResponse("Could not build the export.", { status: 500 });
    }

    const batch = (data ?? []) as WaitlistEntry[];
    rows.push(...batch);
    if (batch.length < CHUNK) break;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const scope = filters.status ? `-${filters.status}` : "";

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="summer-sands-waitlist${scope}-${stamp}.csv"`,
      // Contains personal data and reflects a live table: no shared cache
      // should ever hold a copy, and a second click must not replay the first.
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
