import { getLiveSnapshot } from "@/lib/analytics/queries";

/**
 * Polling endpoint behind the Live View page and the Home visitor pill.
 *
 * Reads through the cookie-scoped Supabase client, so RLS applies and an
 * unauthenticated caller gets an empty snapshot rather than visitor data.
 */
export async function GET() {
  const snapshot = await getLiveSnapshot();

  return Response.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}
