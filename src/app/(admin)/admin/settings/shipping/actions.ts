"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaff as requireStaffSession } from "@/lib/auth/staff";
import { getCourierConfig, toEnvironment } from "@/lib/couriers/config";
import { addressProblems, parsePickupAddress, PACKAGE_LIMITS, type PickupAddress } from "@/lib/couriers/draft";
import { COURIERS, isCourierProvider } from "@/lib/couriers/providers";
import { adapterFor } from "@/lib/couriers/adapters";
import { clearBlueDartTokens } from "@/lib/couriers/bluedart/client";
import { clearDtdcTokens } from "@/lib/couriers/dtdc/client";
import { clearShreeMarutiSessions } from "@/lib/couriers/shreemaruti/client";

/**
 * Shipping settings: the store's pickup profile and the four couriers' credentials.
 *
 * Every write goes through the service-role client, because
 * `integration_credentials` has RLS on and no policies (0016). That bypass is
 * exactly why each action gates on staff status first — a Server Action is a
 * public POST endpoint. A near-copy of settings/qikink/actions.ts on purpose:
 * three integrations that store credentials in the same table should be wrong
 * in the same ways or right in the same ways.
 *
 * Secrets are write-only. A blank secret field on save means "keep what is
 * stored"; the forms never receive the stored value.
 */

type Result = { ok: true; message?: string } | { ok: false; error: string };

async function requireStaff(): Promise<boolean> {
  try {
    return (await requireStaffSession()).ok;
  } catch {
    return false;
  }
}

const DENIED: Result = { ok: false, error: "You do not have permission to change this." };
const NO_ADMIN: Result = { ok: false, error: "Server is not configured for admin writes." };

const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/* -------------------------------------------------------------------------- */
/* Pickup profile                                                              */
/* -------------------------------------------------------------------------- */

export interface ShippingProfileInput {
  pickup: Record<string, string>;
  /** Empty object means "same as pickup". */
  returnAddress: Record<string, string>;
  sameReturn: boolean;
  packageDefaults: { weight_kg: string; length_cm: string; width_cm: string; height_cm: string };
}

function cleanAddress(input: Record<string, string>): PickupAddress {
  const a = parsePickupAddress({
    name: trim(input.name),
    company: trim(input.company),
    phone: trim(input.phone).replace(/[^\d+]/g, ""),
    email: trim(input.email),
    address1: trim(input.address1),
    address2: trim(input.address2),
    landmark: trim(input.landmark),
    city: trim(input.city),
    state: trim(input.state),
    postal_code: trim(input.postal_code).replace(/\D/g, ""),
    country: "IN",
    gst_number: trim(input.gst_number).toUpperCase(),
  });
  return (
    a ?? {
      name: "", company: "", phone: "", email: "", address1: "", address2: "", landmark: "",
      city: "", state: "", postal_code: "", country: "IN", gst_number: "",
    }
  );
}

export async function saveShippingProfile(input: ShippingProfileInput): Promise<Result> {
  if (!(await requireStaff())) return DENIED;
  const supabase = createAdminClient();
  if (!supabase) return NO_ADMIN;

  const pickup = cleanAddress(input.pickup ?? {});
  const problems = addressProblems(pickup, "pickup");
  if (problems.length) return { ok: false, error: problems[0] };

  const returnAddress = input.sameReturn ? null : cleanAddress(input.returnAddress ?? {});
  if (returnAddress) {
    const returnProblems = addressProblems(returnAddress, "return");
    if (returnProblems.length) return { ok: false, error: returnProblems[0] };
  }

  const num = (v: string, min: number, max: number, label: string): number | string => {
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n) || n < min || n > max) return `${label} must be between ${min} and ${max}.`;
    return n;
  };
  const d = input.packageDefaults ?? { weight_kg: "", length_cm: "", width_cm: "", height_cm: "" };
  const weight = num(d.weight_kg, PACKAGE_LIMITS.weightKg.min, PACKAGE_LIMITS.weightKg.max, "Default weight (kg)");
  const length = num(d.length_cm, PACKAGE_LIMITS.dimensionCm.min, PACKAGE_LIMITS.dimensionCm.max, "Default length (cm)");
  const width = num(d.width_cm, PACKAGE_LIMITS.dimensionCm.min, PACKAGE_LIMITS.dimensionCm.max, "Default width (cm)");
  const height = num(d.height_cm, PACKAGE_LIMITS.dimensionCm.min, PACKAGE_LIMITS.dimensionCm.max, "Default height (cm)");
  for (const v of [weight, length, width, height]) if (typeof v === "string") return { ok: false, error: v };

  const { error } = await supabase.from("courier_settings").upsert(
    {
      id: true,
      pickup,
      return_address: returnAddress ?? {},
      package_defaults: { weight_kg: weight, length_cm: length, width_cm: width, height_cm: height },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/settings/shipping");
  return { ok: true, message: "Shipping profile saved" };
}

/* -------------------------------------------------------------------------- */
/* Shree Maruti                                                                */
/* -------------------------------------------------------------------------- */

export interface ShreeMarutiSettingsInput {
  environment: string;
  authMode: string;
  /** Blank keeps the stored value. */
  apiKey?: string;
  username: string;
  /** Blank keeps the stored value. */
  password?: string;
  tenantId: string;
  userId: string;
  /** Blank keeps the stored value. */
  webhookSecret?: string;
  defaultService: string;
  autoManifest: boolean;
  enabled: boolean;
}

export async function saveShreeMarutiSettings(input: ShreeMarutiSettingsInput): Promise<Result> {
  if (!(await requireStaff())) return DENIED;
  const supabase = createAdminClient();
  if (!supabase) return NO_ADMIN;

  const authMode = input.authMode === "password" ? "password" : "api_key";
  const environment = toEnvironment(input.environment);

  const { data: existing } = await supabase
    .from("integration_credentials")
    .select("client_secret, extra_secret, settings")
    .eq("provider", "shreemaruti")
    .maybeSingle();

  const existingSettings = (existing?.settings ?? {}) as Record<string, unknown>;
  const existingMode = existingSettings.auth_mode === "password" ? "password" : "api_key";

  // The secret column holds the API key in one mode and the password in the
  // other. Switching modes must not silently reuse the other one.
  const typed = authMode === "api_key" ? trim(input.apiKey) : trim(input.password);
  const secret = typed || (existingMode === authMode ? existing?.client_secret ?? "" : "");
  const webhookSecret = trim(input.webhookSecret) || existing?.extra_secret || "";
  const username = authMode === "password" ? trim(input.username) : "";

  if (input.enabled) {
    if (authMode === "api_key" && !secret) return { ok: false, error: "Add the API key before switching Shree Maruti on." };
    if (authMode === "password" && (!username || !secret)) {
      return { ok: false, error: "Add the login email and password before switching Shree Maruti on." };
    }
  }

  const { error } = await supabase.from("integration_credentials").upsert(
    {
      provider: "shreemaruti",
      environment,
      client_id: username,
      client_secret: secret,
      extra_secret: webhookSecret,
      enabled: input.enabled,
      auto_send: false,
      settings: {
        auth_mode: authMode,
        tenant_id: trim(input.tenantId),
        user_id: trim(input.userId),
        default_service: input.defaultService === "AIR" ? "AIR" : "SURFACE",
        auto_manifest: input.autoManifest !== false,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" }
  );
  if (error) return { ok: false, error: error.message };

  clearShreeMarutiSessions();
  revalidatePath("/admin/settings/shipping");
  return { ok: true, message: "Shree Maruti settings saved" };
}

/**
 * "Test connection" for any courier: proves the stored credentials without
 * booking anything, through the courier's adapter. Reports the adapter's
 * sentence or the courier's own error — never a token, a secret, or a raw
 * response, since this returns to a browser.
 */
export async function testCourier(provider: string): Promise<Result> {
  if (!(await requireStaff())) return { ok: false, error: "You do not have permission to do this." };
  if (!isCourierProvider(provider)) return { ok: false, error: "Unknown courier." };
  const name = COURIERS[provider].name;
  const config = await getCourierConfig(provider);
  if (!config) return { ok: false, error: `Save the credentials and switch ${name} on first.` };
  try {
    const message = await adapterFor(provider).test(config);
    return { ok: true, message: `${message} (${config.environment})` };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : `Could not reach ${name}.` };
  }
}

export async function testShreeMaruti(): Promise<Result> {
  return testCourier("shreemaruti");
}

/* -------------------------------------------------------------------------- */
/* Blue Dart                                                                   */
/* -------------------------------------------------------------------------- */

export interface BlueDartSettingsInput {
  environment: string;
  clientId: string;
  /** Blank keeps the stored value. */
  clientSecret?: string;
  /** Blank keeps the stored value. */
  licenceKey?: string;
  /** Blank keeps the stored value. */
  trackingLicenceKey?: string;
  loginId: string;
  customerCode: string;
  originArea: string;
  apiType: string;
  defaultService: string;
  registerPickup: boolean;
  pickupTime: string;
  enabled: boolean;
}

export async function saveBlueDartSettings(input: BlueDartSettingsInput): Promise<Result> {
  if (!(await requireStaff())) return DENIED;
  const supabase = createAdminClient();
  if (!supabase) return NO_ADMIN;

  const { data: existing } = await supabase
    .from("integration_credentials")
    .select("client_secret, extra_secret, settings")
    .eq("provider", "bluedart")
    .maybeSingle();
  const existingSettings = (existing?.settings ?? {}) as Record<string, unknown>;

  const clientId = trim(input.clientId);
  const clientSecret = trim(input.clientSecret) || existing?.client_secret || "";
  const licenceKey = trim(input.licenceKey) || existing?.extra_secret || "";
  const trackingLicenceKey = trim(input.trackingLicenceKey) || trim(existingSettings.tracking_licence_key) || "";
  const loginId = trim(input.loginId);
  const customerCode = trim(input.customerCode).toUpperCase();
  const originArea = trim(input.originArea).toUpperCase();
  const pickupTime = trim(input.pickupTime).replace(":", "");
  const service = COURIERS.bluedart.services.some((s) => s.code === input.defaultService) ? input.defaultService : "D";

  if (originArea && !/^[A-Z]{3}$/.test(originArea)) {
    return { ok: false, error: "Origin area is Blue Dart's 3-letter area code, e.g. BOM or DEL." };
  }
  if (pickupTime && !/^([01]\d|2[0-3])[0-5]\d$/.test(pickupTime)) {
    return { ok: false, error: "Pickup time must be HHMM in 24-hour format, e.g. 1600." };
  }
  if (input.enabled && !(clientId && clientSecret && licenceKey && loginId && customerCode && originArea)) {
    return {
      ok: false,
      error: "Blue Dart needs the consumer key and secret, licence key, login ID, customer code and origin area before it can be switched on.",
    };
  }

  const { error } = await supabase.from("integration_credentials").upsert(
    {
      provider: "bluedart",
      environment: toEnvironment(input.environment),
      client_id: clientId,
      client_secret: clientSecret,
      extra_secret: licenceKey,
      enabled: input.enabled,
      auto_send: false,
      settings: {
        login_id: loginId,
        customer_code: customerCode,
        origin_area: originArea,
        api_type: trim(input.apiType) || "S",
        default_service: service,
        register_pickup: input.registerPickup === true,
        pickup_time: pickupTime || "1600",
        tracking_licence_key: trackingLicenceKey,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" }
  );
  if (error) return { ok: false, error: error.message };

  clearBlueDartTokens();
  revalidatePath("/admin/settings/shipping");
  return { ok: true, message: "Blue Dart settings saved" };
}

export async function testBlueDart(): Promise<Result> {
  return testCourier("bluedart");
}

/* -------------------------------------------------------------------------- */
/* DTDC                                                                        */
/* -------------------------------------------------------------------------- */

export interface DtdcSettingsInput {
  environment: string;
  /** Blank keeps the stored value. */
  apiKey?: string;
  customerCode: string;
  defaultService: string;
  commodityId: string;
  codCollectionMode: string;
  trackingUsername: string;
  /** Password for the username, or the static access token. Blank keeps the stored value. */
  trackingSecret?: string;
  enabled: boolean;
}

export async function saveDtdcSettings(input: DtdcSettingsInput): Promise<Result> {
  if (!(await requireStaff())) return DENIED;
  const supabase = createAdminClient();
  if (!supabase) return NO_ADMIN;

  const { data: existing } = await supabase
    .from("integration_credentials")
    .select("client_secret, extra_secret")
    .eq("provider", "dtdc")
    .maybeSingle();

  const apiKey = trim(input.apiKey) || existing?.client_secret || "";
  const trackingSecret = trim(input.trackingSecret) || existing?.extra_secret || "";
  const customerCode = trim(input.customerCode).toUpperCase();
  const service = COURIERS.dtdc.services.some((s) => s.code === input.defaultService) ? input.defaultService : "B2C SMART EXPRESS";

  if (input.enabled && !(apiKey && customerCode)) {
    return { ok: false, error: "DTDC needs the API key and customer code before it can be switched on." };
  }

  const { error } = await supabase.from("integration_credentials").upsert(
    {
      provider: "dtdc",
      environment: toEnvironment(input.environment),
      client_id: customerCode,
      client_secret: apiKey,
      extra_secret: trackingSecret,
      enabled: input.enabled,
      auto_send: false,
      settings: {
        customer_code: customerCode,
        default_service: service,
        commodity_id: trim(input.commodityId) || "99",
        cod_collection_mode: trim(input.codCollectionMode).toLowerCase() || "cash",
        tracking_username: trim(input.trackingUsername),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" }
  );
  if (error) return { ok: false, error: error.message };

  clearDtdcTokens();
  revalidatePath("/admin/settings/shipping");
  return { ok: true, message: "DTDC settings saved" };
}

export async function testDtdc(): Promise<Result> {
  return testCourier("dtdc");
}

/* -------------------------------------------------------------------------- */
/* Delhivery                                                                   */
/* -------------------------------------------------------------------------- */

export interface DelhiverySettingsInput {
  environment: string;
  /** Blank keeps the stored value. */
  token?: string;
  pickupLocation: string;
  defaultService: string;
  sellerGstin: string;
  enabled: boolean;
}

export async function saveDelhiverySettings(input: DelhiverySettingsInput): Promise<Result> {
  if (!(await requireStaff())) return DENIED;
  const supabase = createAdminClient();
  if (!supabase) return NO_ADMIN;

  const { data: existing } = await supabase
    .from("integration_credentials")
    .select("client_secret")
    .eq("provider", "delhivery")
    .maybeSingle();

  const token = trim(input.token) || existing?.client_secret || "";
  // Verbatim, not trimmed of inner spaces: their match is exact.
  const pickupLocation = typeof input.pickupLocation === "string" ? input.pickupLocation.trim() : "";
  const sellerGstin = trim(input.sellerGstin).toUpperCase();

  if (sellerGstin && !/^[0-9A-Z]{15}$/.test(sellerGstin)) {
    return { ok: false, error: "A GSTIN is 15 letters and digits, e.g. 27ABCDE1234F1Z5." };
  }
  if (input.enabled && !(token && pickupLocation)) {
    return { ok: false, error: "Delhivery needs the API token and the registered pickup location name before it can be switched on." };
  }

  const { error } = await supabase.from("integration_credentials").upsert(
    {
      provider: "delhivery",
      environment: toEnvironment(input.environment),
      client_id: pickupLocation,
      client_secret: token,
      extra_secret: "",
      enabled: input.enabled,
      auto_send: false,
      settings: {
        pickup_location: pickupLocation,
        default_service: input.defaultService === "Express" ? "Express" : "Surface",
        seller_gstin: sellerGstin,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/settings/shipping");
  return { ok: true, message: "Delhivery settings saved" };
}

export async function testDelhivery(): Promise<Result> {
  return testCourier("delhivery");
}
