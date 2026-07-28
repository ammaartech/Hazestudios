import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Qikink configuration.
 *
 * Server-only by construction: everything here goes through the service-role
 * client, because `integration_credentials` has RLS on and no policies (see
 * 0016_qikink.sql). Importing this from a Client Component will fail the build
 * at the Supabase import, which is the intended outcome — the secret must never
 * be part of a payload sent to a browser.
 */

export const PROVIDER = "qikink";

export type QikinkEnvironment = "sandbox" | "live";

/** Qikink declines plain HTTP; both hosts are HTTPS-only. */
export const HOSTS: Record<QikinkEnvironment, string> = {
  sandbox: "https://sandbox.qikink.com",
  live: "https://api.qikink.com",
};

export interface QikinkConfig {
  environment: QikinkEnvironment;
  clientId: string;
  clientSecret: string;
  enabled: boolean;
  autoSend: boolean;
}

/** What the settings UI is allowed to see. Note the absence of the secret. */
export interface QikinkStatus {
  environment: QikinkEnvironment;
  clientId: string;
  /** Whether a secret is stored — never the value itself. */
  hasSecret: boolean;
  enabled: boolean;
  autoSend: boolean;
  /** True once there is enough to actually call the API. */
  configured: boolean;
}

const EMPTY: QikinkStatus = {
  environment: "sandbox",
  clientId: "",
  hasSecret: false,
  enabled: false,
  autoSend: false,
  configured: false,
};

/**
 * Full credentials, for the code that calls Qikink.
 *
 * Returns null when the integration is off or half-configured rather than
 * throwing: every caller's correct response to "not set up" is to do nothing,
 * and a missing integration is not an error condition.
 */
export async function getQikinkConfig(): Promise<QikinkConfig | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("integration_credentials")
    .select("environment, client_id, client_secret, enabled, auto_send")
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (!data?.enabled || !data.client_id || !data.client_secret) return null;

  return {
    environment: data.environment as QikinkEnvironment,
    clientId: data.client_id,
    clientSecret: data.client_secret,
    enabled: data.enabled,
    autoSend: data.auto_send,
  };
}

/** The redacted view, for rendering the settings page. */
export async function getQikinkStatus(): Promise<QikinkStatus> {
  const supabase = createAdminClient();
  if (!supabase) return EMPTY;

  const { data } = await supabase
    .from("integration_credentials")
    .select("environment, client_id, client_secret, enabled, auto_send")
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (!data) return EMPTY;

  const hasSecret = Boolean(data.client_secret);
  return {
    environment: data.environment as QikinkEnvironment,
    clientId: data.client_id ?? "",
    hasSecret,
    enabled: data.enabled,
    autoSend: data.auto_send,
    configured: Boolean(data.client_id) && hasSecret,
  };
}
