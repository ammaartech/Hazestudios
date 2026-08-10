import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cashfree configuration.
 *
 * Server-only by construction, for the same reason as Qikink's: everything here
 * goes through the service-role client, because `integration_credentials` has
 * RLS on and no policies (0016_qikink.sql). Importing this from a Client
 * Component fails the build at the Supabase import, which is the intended
 * outcome — a payment secret must never be part of a payload sent to a browser.
 *
 * Credentials live in that table rather than in env vars, matching Qikink. It
 * is the same kind of secret with the same rotation story, and putting it in
 * the database means the merchant can switch environments or re-key from the
 * admin without a redeploy. It also means there is exactly one place in this
 * app where a third-party secret lives.
 */

export const PROVIDER = "cashfree";

/**
 * The API contract this client is written against.
 *
 * Cashfree versions their API by date and sends the header on every request;
 * an older string silently changes response shapes rather than erroring, so it
 * is pinned here rather than left to a default.
 */
export const API_VERSION = "2026-01-01";

/**
 * Ours, not theirs.
 *
 * `integration_credentials.environment` is constrained to sandbox|live by
 * 0016, and that column is shared with Qikink. Cashfree's own word for the
 * second one is "production" — see SDK_MODE, which is the only place the
 * difference matters.
 */
export type CashfreeEnvironment = "sandbox" | "live";

export const HOSTS: Record<CashfreeEnvironment, string> = {
  sandbox: "https://sandbox.cashfree.com",
  live: "https://api.cashfree.com",
};

/** What their browser SDK calls the same two environments. */
export const SDK_MODE: Record<CashfreeEnvironment, "sandbox" | "production"> = {
  sandbox: "sandbox",
  live: "production",
};

export type CashfreeMode = (typeof SDK_MODE)[CashfreeEnvironment];

export interface CashfreeConfig {
  environment: CashfreeEnvironment;
  /** Cashfree calls this the App ID; the shared table calls it client_id. */
  appId: string;
  /** The Secret Key. Also the key their webhook signatures are computed with. */
  secretKey: string;
  enabled: boolean;
}

/** What the settings UI is allowed to see. Note the absence of the secret. */
export interface CashfreeStatus {
  environment: CashfreeEnvironment;
  appId: string;
  /** Whether a secret is stored — never the value itself. */
  hasSecret: boolean;
  enabled: boolean;
  /** True once there is enough to actually call the API. */
  configured: boolean;
}

const EMPTY: CashfreeStatus = {
  environment: "sandbox",
  appId: "",
  hasSecret: false,
  enabled: false,
  configured: false,
};

const COLUMNS = "environment, client_id, client_secret, enabled";

/**
 * Full credentials, for the code that calls Cashfree.
 *
 * Returns null when the gateway is off or half-configured rather than throwing.
 * Every caller's correct response to "no gateway" is the same — hide prepaid,
 * refuse the order, say so plainly — and none of them is an error path.
 *
 * The `auto_send` column on the shared table belongs to Qikink and is ignored
 * here: whether a paid order goes to the printer is Qikink's setting to make,
 * not the gateway's.
 */
export async function getCashfreeConfig(): Promise<CashfreeConfig | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("integration_credentials")
    .select(COLUMNS)
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (!data?.enabled || !data.client_id || !data.client_secret) return null;

  return {
    environment: data.environment as CashfreeEnvironment,
    appId: data.client_id,
    secretKey: data.client_secret,
    enabled: data.enabled,
  };
}

/** The redacted view, for rendering the settings page. */
export async function getCashfreeStatus(): Promise<CashfreeStatus> {
  const supabase = createAdminClient();
  if (!supabase) return EMPTY;

  const { data } = await supabase
    .from("integration_credentials")
    .select(COLUMNS)
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (!data) return EMPTY;

  const hasSecret = Boolean(data.client_secret);
  return {
    environment: data.environment as CashfreeEnvironment,
    appId: data.client_id ?? "",
    hasSecret,
    enabled: data.enabled,
    configured: Boolean(data.client_id) && hasSecret,
  };
}
