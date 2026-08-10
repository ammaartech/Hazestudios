"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { testConnection } from "@/lib/cashfree/client";
import {
  HOSTS,
  PROVIDER,
  type CashfreeEnvironment,
} from "@/lib/cashfree/config";

/**
 * Cashfree settings.
 *
 * Every write here goes through the service-role client, because
 * `integration_credentials` has RLS on and no policies (0016_qikink.sql). That
 * bypass is exactly why each action gates on `is_staff()` first: a Server Action
 * is a public POST endpoint, and without the gate this file would let anyone on
 * the internet read the store's payment secret back out through "test
 * connection" — the one secret in this application that can move money.
 *
 * A near-copy of settings/qikink/actions.ts on purpose. Two integrations that
 * store credentials in the same table should be wrong in the same ways or right
 * in the same ways, and a clever abstraction over two forms is a worse trade
 * than the duplication.
 */

type Result = { ok: true; message?: string } | { ok: false; error: string };

async function requireStaff(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("is_staff");
    return Boolean(data);
  } catch {
    return false;
  }
}

const ENVIRONMENTS: CashfreeEnvironment[] = ["sandbox", "live"];

export async function saveCashfreeSettings(input: {
  environment: string;
  appId: string;
  /** Omitted or blank keeps the stored secret; the form never round-trips it. */
  secretKey?: string;
  enabled: boolean;
}): Promise<Result> {
  if (!(await requireStaff())) {
    return { ok: false, error: "You do not have permission to change this." };
  }

  const supabase = createAdminClient();
  if (!supabase) {
    return { ok: false, error: "Server is not configured for admin writes." };
  }

  const environment = ENVIRONMENTS.includes(input.environment as CashfreeEnvironment)
    ? (input.environment as CashfreeEnvironment)
    : "sandbox";

  const appId = input.appId.trim();
  const secretKey = input.secretKey?.trim() ?? "";

  const { data: existing } = await supabase
    .from("integration_credentials")
    .select("client_secret")
    .eq("provider", PROVIDER)
    .maybeSingle();

  const secret = secretKey || existing?.client_secret || "";

  if (input.enabled && (!appId || !secret)) {
    return {
      ok: false,
      error: "Add both an App ID and a Secret Key before switching payments on.",
    };
  }

  const { error } = await supabase.from("integration_credentials").upsert(
    {
      provider: PROVIDER,
      environment,
      client_id: appId,
      client_secret: secret,
      enabled: input.enabled,
      // Belongs to Qikink, which shares this table. Written explicitly so the
      // upsert cannot leave it null against a not-null column on first insert.
      auto_send: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" }
  );

  if (error) return { ok: false, error: error.message };

  // The checkout page reads `getCashfreeConfig()` to decide whether prepaid is
  // offered, so switching the gateway on has to reach the storefront and not
  // just this page.
  revalidatePath("/admin/settings/payments");
  revalidatePath("/checkout");

  return { ok: true, message: "Payment settings saved" };
}

/**
 * Proves the stored credentials authenticate.
 *
 * Reports success or Cashfree's own message and nothing else — deliberately not
 * the secret, the App ID, or the raw response, since this returns to a browser.
 */
export async function testCashfreeConnection(): Promise<Result> {
  if (!(await requireStaff())) {
    return { ok: false, error: "You do not have permission to do this." };
  }

  const supabase = createAdminClient();
  if (!supabase) {
    return { ok: false, error: "Server is not configured for admin writes." };
  }

  const { data } = await supabase
    .from("integration_credentials")
    .select("environment, client_id, client_secret")
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (!data?.client_id || !data.client_secret) {
    return { ok: false, error: "Add an App ID and Secret Key first." };
  }

  const environment = data.environment as CashfreeEnvironment;

  try {
    await testConnection({
      environment,
      appId: data.client_id,
      secretKey: data.client_secret,
      enabled: true,
    });
    return { ok: true, message: `Authenticated against ${HOSTS[environment]}` };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "Could not reach Cashfree.",
    };
  }
}
