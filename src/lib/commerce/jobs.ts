import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileAttempt, type PaymentAttempt } from "@/lib/cashfree/payment";
import { pushOrderToQikink } from "@/lib/qikink/fulfillment";

type Job = {
  id: string; kind: "fulfill" | "reconcile" | "expire"; order_id: string;
  payment_id: string | null; lease_token: string; attempts: number; failures: number;
};
type Decision = { delay?: number; review?: string };

async function perform(job: Job): Promise<Decision> {
  const db = createAdminClient()!;
  if (job.kind === "reconcile") {
    const { data: attempt, error } = await db.from("payments").select("*").eq("id", job.payment_id!).single();
    if (error) throw error;
    if (attempt.status === "success" || attempt.gateway_closed_at) return {};
    await reconcileAttempt(attempt as PaymentAttempt);
    const { data: settled, error: readError } = await db.from("payments").select("status,gateway_closed_at,reconciliation_required").eq("id", job.payment_id!).single();
    if (readError) throw readError;
    if (settled.reconciliation_required) return { review: "Captured payment needs manual review" };
    return settled.status === "success" || settled.gateway_closed_at ? {} : { delay: 120 };
  }
  const { data: order, error } = await db.from("orders").select("*").eq("id", job.order_id).single();
  if (error) throw error;
  if (job.kind === "expire") {
    if (order.stock_released_at || order.cancelled_at || order.payment_status !== "pending") return {};
    if (new Date(order.reservation_expires_at).getTime() > Date.now()) return { delay: 120 };
    const { data: released, error: releaseError } = await db.rpc("release_checkout_stock", { p_order_id: job.order_id });
    if (releaseError) throw releaseError;
    return released ? {} : { delay: 120 };
  }
  if (order.cancelled_at || order.stock_released_at || order.is_draft) return {};
  if (order.held_at && !order.released_at) return { delay: 900 };
  if (order.payment_method !== "cod" && order.payment_status !== "paid") return { delay: 120 };
  const { data: config, error: configError } = await db.from("integration_credentials")
    .select("enabled,auto_send").eq("provider", "qikink").maybeSingle();
  if (configError) throw configError; // A failed read must never discard a job.
  if (!config?.enabled || !config.auto_send) return {}; // Auto-send remains a merchant choice.
  // A shared budget leaves room for admin tracking traffic; no 100-request supplier burst.
  const { data: allowed, error: limitError } = await db.rpc("consume_commerce_rate", {
    p_key: "qikink-auto-send", p_limit: 10, p_seconds: 60,
  });
  if (limitError) throw limitError;
  if (!allowed) return { delay: 60 };
  const result = await pushOrderToQikink(job.order_id);
  if (!result.ok) {
    if (result.reviewRequired) return { review: result.error };
    throw new Error(result.error);
  }
  return {};
}

/** Bounded work, leased in Postgres. Another invocation recovers an interrupted lease. */
export async function runCommerceJobs() {
  const db = createAdminClient();
  if (!db) throw new Error("Commerce database unavailable");
  const started = Date.now();
  const summary = { completed: 0, deferred: 0, failed: 0 };
  // Alternate kinds so a large payment backlog cannot starve fulfillment or stock release.
  const kinds = ["reconcile", "fulfill", "expire"];
  for (let i = 0; i < 30 && Date.now() - started < 40_000; i++) {
    const { data, error } = await db.rpc("claim_commerce_job", { p_kind: kinds[i % kinds.length] });
    if (error) throw error;
    if (!data) continue;
    const job = data as Job;
    let decision: Decision;
    let failure: string | null = null;
    try {
      decision = await perform(job);
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : "Commerce job failed";
      decision = job.failures >= 11
        ? { review: failure }
        : { delay: Math.min(3600, 30 * 2 ** Math.min(job.failures + 1, 7)) };
    }
    const state = decision.review ? "failed" : decision.delay ? "ready" : "done";
    const { error: finishError } = await db.from("commerce_jobs").update({
      status: state, available_at: new Date(Date.now() + (decision.delay ?? 0) * 1000).toISOString(),
      lease_until: null, lease_token: null, last_error: decision.review ?? failure,
      failures: failure ? job.failures + 1 : 0,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("lease_token", job.lease_token);
    if (finishError) throw finishError;
    if (state === "failed") {
      summary.failed++;
      console.error("[commerce] job needs review", { jobId: job.id, kind: job.kind, orderId: job.order_id });
    } else if (state === "ready") summary.deferred++;
    else summary.completed++;
  }
  const { error: cleanupError } = await db.from("commerce_rate_limits").delete().lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());
  if (cleanupError) throw cleanupError;
  const { error: heartbeatError } = await db.from("commerce_worker_health").upsert({
    id: 1, last_finished_at: new Date().toISOString(), summary,
  });
  if (heartbeatError) throw heartbeatError;
  console.info("[commerce] worker completed", summary);
  return summary;
}
