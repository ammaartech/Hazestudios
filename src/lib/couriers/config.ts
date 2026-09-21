import { createAdminClient } from "@/lib/supabase/admin";
import {
  parsePackageDefaults,
  parsePickupAddress,
  type CourierSettings,
  type PackageDefaults,
  type PickupAddress,
} from "./draft";
import { COURIER_PROVIDERS, type CourierProvider } from "./providers";

/**
 * Courier configuration: credentials for the two APIs, and the store's own
 * shipping profile (pickup address, parcel defaults).
 *
 * Server-only by construction, like `qikink/config.ts`: everything here goes
 * through the service-role client because `integration_credentials` has RLS on
 * and no policies (0016). Importing this from a Client Component fails the
 * build at the Supabase import, which is the intended outcome.
 *
 * Credentials come back in two shapes. The *full* config, for code that calls a
 * courier, returns null when the integration is off or half-filled — every
 * caller's correct response to "not set up" is to do nothing. The *status* is
 * the redacted projection the settings page renders: ids and flags, and a
 * boolean per secret, never the value.
 */

export type CourierEnvironment = "sandbox" | "live";

const ENVIRONMENTS: CourierEnvironment[] = ["sandbox", "live"];

export function toEnvironment(value: unknown): CourierEnvironment {
  return ENVIRONMENTS.includes(value as CourierEnvironment) ? (value as CourierEnvironment) : "sandbox";
}

/* -------------------------------------------------------------------------- */
/* Shree Maruti                                                                */
/* -------------------------------------------------------------------------- */

/**
 * InnoFulfill supports two ways in. An API key from the portal's settings is
 * the simple one and needs nothing else. Email + password logs in for a
 * 24-hour id token and also *tells us* the tenant and user ids, which the
 * label endpoint wants in its body — so a merchant using an API key has to
 * copy those two ids from the portal by hand, and one using a login does not.
 */
export type ShreeMarutiAuthMode = "api_key" | "password";

export interface ShreeMarutiConfig {
  provider: "shreemaruti";
  environment: CourierEnvironment;
  authMode: ShreeMarutiAuthMode;
  /** API key (api_key mode). Empty otherwise. */
  apiKey: string;
  /** Login email and password (password mode). Empty otherwise. */
  username: string;
  password: string;
  /** Optional; learned from a login, or entered by hand for API-key accounts. */
  tenantId: string;
  userId: string;
  /** Signs their webhooks. Optional until the webhook is set up on their side. */
  webhookSecret: string;
  defaultService: "SURFACE" | "AIR";
  /** Mark the booking ready for dispatch immediately — no separate manifest step. */
  autoManifest: boolean;
}

export interface ShreeMarutiStatus {
  provider: "shreemaruti";
  environment: CourierEnvironment;
  authMode: ShreeMarutiAuthMode;
  username: string;
  hasApiKey: boolean;
  hasPassword: boolean;
  hasWebhookSecret: boolean;
  tenantId: string;
  userId: string;
  defaultService: "SURFACE" | "AIR";
  autoManifest: boolean;
  enabled: boolean;
  configured: boolean;
}

/* -------------------------------------------------------------------------- */
/* Blue Dart                                                                   */
/* -------------------------------------------------------------------------- */

export interface BlueDartConfig {
  provider: "bluedart";
  environment: CourierEnvironment;
  /** The APIGEE app's consumer key and secret — they mint the JWT. */
  clientId: string;
  clientSecret: string;
  /** Rides in every payload's `Profile`, alongside the login id. */
  licenceKey: string;
  /**
   * Blue Dart licenses tracking separately from shipping on some accounts and
   * issues a second key for it. Empty means "use the shipping key", which is
   * right for accounts with a single key.
   */
  trackingLicenceKey: string;
  loginId: string;
  /** The billing customer code (6 characters) and the origin area code (3). */
  customerCode: string;
  originArea: string;
  /** `Profile.Api_type` — "S" for shipping. */
  apiType: string;
  defaultService: string;
  /** Ask Blue Dart to also register a pickup when generating the waybill. */
  registerPickup: boolean;
  /** "HHMM", the latest time a pickup can happen — sent as PickupTime. */
  pickupTime: string;
}

export interface BlueDartStatus {
  provider: "bluedart";
  environment: CourierEnvironment;
  clientId: string;
  hasClientSecret: boolean;
  hasLicenceKey: boolean;
  hasTrackingLicenceKey: boolean;
  loginId: string;
  customerCode: string;
  originArea: string;
  apiType: string;
  defaultService: string;
  registerPickup: boolean;
  pickupTime: string;
  enabled: boolean;
  configured: boolean;
}

export type CourierConfig = ShreeMarutiConfig | BlueDartConfig;
export type CourierStatus = ShreeMarutiStatus | BlueDartStatus;

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

interface CredentialRow {
  provider: string;
  environment: string;
  client_id: string | null;
  client_secret: string | null;
  extra_secret: string | null;
  enabled: boolean;
  settings: Record<string, unknown> | null;
}

const COLUMNS = "provider, environment, client_id, client_secret, extra_secret, enabled, settings";

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function readRow(provider: CourierProvider): Promise<CredentialRow | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("integration_credentials")
    .select(COLUMNS)
    .eq("provider", provider)
    .maybeSingle();
  return (data as CredentialRow | null) ?? null;
}

function shreeMarutiFrom(row: CredentialRow): ShreeMarutiConfig {
  const settings = row.settings ?? {};
  const authMode: ShreeMarutiAuthMode = settings.auth_mode === "password" ? "password" : "api_key";
  return {
    provider: "shreemaruti",
    environment: toEnvironment(row.environment),
    authMode,
    apiKey: authMode === "api_key" ? s(row.client_secret) : "",
    username: authMode === "password" ? s(row.client_id) : "",
    password: authMode === "password" ? s(row.client_secret) : "",
    tenantId: s(settings.tenant_id),
    userId: s(settings.user_id),
    webhookSecret: s(row.extra_secret),
    defaultService: settings.default_service === "AIR" ? "AIR" : "SURFACE",
    autoManifest: settings.auto_manifest !== false,
  };
}

function shreeMarutiConfigured(c: ShreeMarutiConfig): boolean {
  return c.authMode === "api_key" ? Boolean(c.apiKey) : Boolean(c.username && c.password);
}

function blueDartFrom(row: CredentialRow): BlueDartConfig {
  const settings = row.settings ?? {};
  return {
    provider: "bluedart",
    environment: toEnvironment(row.environment),
    clientId: s(row.client_id),
    clientSecret: s(row.client_secret),
    licenceKey: s(row.extra_secret),
    // In `settings` rather than a third secret column: it is service-role
    // only either way, and the status projection below never echoes it.
    trackingLicenceKey: s(settings.tracking_licence_key),
    loginId: s(settings.login_id),
    customerCode: s(settings.customer_code),
    originArea: s(settings.origin_area).toUpperCase(),
    apiType: s(settings.api_type) || "S",
    defaultService: s(settings.default_service) || "D",
    registerPickup: settings.register_pickup === true,
    pickupTime: /^\d{4}$/.test(s(settings.pickup_time)) ? s(settings.pickup_time) : "1600",
  };
}

function blueDartConfigured(c: BlueDartConfig): boolean {
  return Boolean(
    c.clientId && c.clientSecret && c.licenceKey && c.loginId && c.customerCode && c.originArea
  );
}

/** Full credentials, or null when the courier is off or not fully set up. */
export async function getCourierConfig(provider: "shreemaruti"): Promise<ShreeMarutiConfig | null>;
export async function getCourierConfig(provider: "bluedart"): Promise<BlueDartConfig | null>;
export async function getCourierConfig(provider: CourierProvider): Promise<CourierConfig | null>;
export async function getCourierConfig(provider: CourierProvider): Promise<CourierConfig | null> {
  const row = await readRow(provider);
  if (!row?.enabled) return null;
  if (provider === "shreemaruti") {
    const config = shreeMarutiFrom(row);
    return shreeMarutiConfigured(config) ? config : null;
  }
  const config = blueDartFrom(row);
  return blueDartConfigured(config) ? config : null;
}

/** The redacted view, for the settings page and the order page's dialog. */
export async function getCourierStatus(provider: "shreemaruti"): Promise<ShreeMarutiStatus>;
export async function getCourierStatus(provider: "bluedart"): Promise<BlueDartStatus>;
export async function getCourierStatus(provider: CourierProvider): Promise<CourierStatus>;
export async function getCourierStatus(provider: CourierProvider): Promise<CourierStatus> {
  const row = await readRow(provider);

  if (provider === "shreemaruti") {
    const c = shreeMarutiFrom(
      row ?? { provider, environment: "sandbox", client_id: "", client_secret: "", extra_secret: "", enabled: false, settings: {} }
    );
    return {
      provider: "shreemaruti",
      environment: c.environment,
      authMode: c.authMode,
      username: c.username,
      hasApiKey: Boolean(c.apiKey),
      hasPassword: Boolean(c.password),
      hasWebhookSecret: Boolean(c.webhookSecret),
      tenantId: c.tenantId,
      userId: c.userId,
      defaultService: c.defaultService,
      autoManifest: c.autoManifest,
      enabled: row?.enabled ?? false,
      configured: shreeMarutiConfigured(c),
    };
  }

  const c = blueDartFrom(
    row ?? { provider, environment: "sandbox", client_id: "", client_secret: "", extra_secret: "", enabled: false, settings: {} }
  );
  return {
    provider: "bluedart",
    environment: c.environment,
    clientId: c.clientId,
    hasClientSecret: Boolean(c.clientSecret),
    hasLicenceKey: Boolean(c.licenceKey),
    hasTrackingLicenceKey: Boolean(c.trackingLicenceKey),
    loginId: c.loginId,
    customerCode: c.customerCode,
    originArea: c.originArea,
    apiType: c.apiType,
    defaultService: c.defaultService,
    registerPickup: c.registerPickup,
    pickupTime: c.pickupTime,
    enabled: row?.enabled ?? false,
    configured: blueDartConfigured(c),
  };
}

/**
 * What the order page needs to offer the "Ship now" button: which couriers can
 * actually be booked right now. Both rows in one query rather than two.
 */
export interface CourierAvailability {
  provider: CourierProvider;
  /** Enabled and fully configured — a booking would reach the API. */
  ready: boolean;
  environment: CourierEnvironment;
  defaultService: string;
}

export async function getCourierAvailability(): Promise<Record<CourierProvider, CourierAvailability>> {
  const result = {} as Record<CourierProvider, CourierAvailability>;
  for (const provider of COURIER_PROVIDERS) {
    result[provider] = { provider, ready: false, environment: "sandbox", defaultService: "" };
  }

  const supabase = createAdminClient();
  if (!supabase) return result;

  const { data } = await supabase
    .from("integration_credentials")
    .select(COLUMNS)
    .in("provider", COURIER_PROVIDERS);

  for (const row of (data ?? []) as CredentialRow[]) {
    if (row.provider === "shreemaruti") {
      const c = shreeMarutiFrom(row);
      result.shreemaruti = {
        provider: "shreemaruti",
        ready: row.enabled && shreeMarutiConfigured(c),
        environment: c.environment,
        defaultService: c.defaultService,
      };
    } else if (row.provider === "bluedart") {
      const c = blueDartFrom(row);
      result.bluedart = {
        provider: "bluedart",
        ready: row.enabled && blueDartConfigured(c),
        environment: c.environment,
        defaultService: c.defaultService,
      };
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* The store's shipping profile                                                */
/* -------------------------------------------------------------------------- */

/**
 * Pickup address, return address, parcel defaults — `courier_settings`, the
 * singleton row. Read with the service role rather than the cookie client
 * because the booking path runs from a Server Action that has already gated on
 * staff, and the webhook route has no session at all.
 *
 * Never throws: a store with no row behaves as one with nothing entered, and
 * the draft builder turns that into "No pickup address has been set up yet."
 */
export async function getCourierSettings(): Promise<CourierSettings> {
  const empty: CourierSettings = { pickup: null, returnAddress: null, packageDefaults: parsePackageDefaults(null) };
  const supabase = createAdminClient();
  if (!supabase) return empty;

  const { data } = await supabase
    .from("courier_settings")
    .select("pickup, return_address, package_defaults")
    .eq("id", true)
    .maybeSingle();
  if (!data) return empty;

  return {
    pickup: parsePickupAddress(data.pickup),
    returnAddress: parsePickupAddress(data.return_address),
    packageDefaults: parsePackageDefaults(data.package_defaults),
  };
}

export type { CourierSettings, PackageDefaults, PickupAddress };
