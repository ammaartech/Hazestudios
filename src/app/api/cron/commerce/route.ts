import { timingSafeEqual } from "node:crypto";
import { runCommerceJobs } from "@/lib/commerce/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    if (new URL(request.url).searchParams.get("health") === "1") {
      const db = createAdminClient();
      if (!db) throw new Error("Database unavailable");
      const { data, error } = await db.rpc("commerce_health");
      if (error) throw error;
      const healthy = data.lastFinishedAt && Date.now() - new Date(data.lastFinishedAt).getTime() < 300_000
        && !data.failedJobs && !data.paymentsNeedingReview && !data.uncertainDispatches
        && data.oldestDueSeconds < 900;
      return Response.json({ healthy: Boolean(healthy), ...data }, {
        status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json(await runCommerceJobs(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[commerce] worker unavailable");
    return new Response("Service unavailable", { status: 503 });
  }
}
