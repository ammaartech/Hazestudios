import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/** Database-backed limits remain shared across serverless instances. */
export async function commerceRateLimit(scope: string, token: string): Promise<string | null> {
  if (!token || token.length > 256) return "Invalid checkout link.";
  const db = createAdminClient();
  if (!db) return "Checkout is temporarily unavailable. Please try again shortly.";
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const requestHeaders = await headers();
  // Vercel sets this header. Never trust arbitrary forwarded IPs outside that platform.
  const ip = process.env.VERCEL ? requestHeaders.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : null;
  const keys = [{ key: `${scope}:${digest(token)}`, limit: 12 }];
  if (ip) keys.push({ key: `commerce-ip:${digest(ip)}`, limit: 600 });
  for (const { key, limit } of keys) {
    const { data, error } = await db.rpc("consume_commerce_rate", { p_key: key, p_limit: limit, p_seconds: 60 });
    if (error) return "Checkout is temporarily unavailable. Please try again shortly.";
    if (!data) return "Too many attempts. Please wait a minute and try again.";
  }
  return null;
}

/** Retry only transaction-abort errors; every repeat also uses the persisted cart key. */
export async function retryCheckout<T extends { error: { code?: string } | null }>(
  operation: () => PromiseLike<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const result = await operation();
    if (attempt >= 2 || !["40P01", "40001", "55P03"].includes(result.error?.code ?? "")) return result;
    await new Promise((resolve) => setTimeout(resolve, 75 * 2 ** attempt + Math.random() * 100));
  }
}
