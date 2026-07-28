"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  clearTokenCache,
  createOrder,
  fetchOrder,
  testConnection,
  type QikinkLineItem,
} from "@/lib/qikink/client";
import {
  HOSTS,
  PROVIDER,
  getQikinkConfig,
  type QikinkEnvironment,
} from "@/lib/qikink/config";

/**
 * Qikink settings.
 *
 * Every write here goes through the service-role client, because
 * `integration_credentials` has RLS on and no policies (0016_qikink.sql). That
 * bypass is exactly why each action gates on `is_staff()` first: a Server Action
 * is a public POST endpoint, and without the gate this file would let anyone on
 * the internet read the store's API secret back out through "test connection".
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

const ENVIRONMENTS: QikinkEnvironment[] = ["sandbox", "live"];

export async function saveQikinkSettings(input: {
  environment: string;
  clientId: string;
  /** Omitted or blank keeps the stored secret; the form never round-trips it. */
  clientSecret?: string;
  enabled: boolean;
  autoSend: boolean;
}): Promise<Result> {
  if (!(await requireStaff())) {
    return { ok: false, error: "You do not have permission to change this." };
  }

  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: "Server is not configured for admin writes." };

  const environment = ENVIRONMENTS.includes(input.environment as QikinkEnvironment)
    ? (input.environment as QikinkEnvironment)
    : "sandbox";

  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret?.trim() ?? "";

  const { data: existing } = await supabase
    .from("integration_credentials")
    .select("client_secret")
    .eq("provider", PROVIDER)
    .maybeSingle();

  const secret = clientSecret || existing?.client_secret || "";

  if (input.enabled && (!clientId || !secret)) {
    return { ok: false, error: "Add both a Client ID and a Client Secret before enabling." };
  }

  const { error } = await supabase.from("integration_credentials").upsert(
    {
      provider: PROVIDER,
      environment,
      client_id: clientId,
      client_secret: secret,
      enabled: input.enabled,
      auto_send: input.autoSend,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" }
  );

  if (error) return { ok: false, error: error.message };

  // A cached token belongs to the credentials that minted it. Rotating the
  // secret or switching environment must not keep using the old one.
  clearTokenCache();
  revalidatePath("/admin/settings/qikink");
  return { ok: true, message: "Qikink settings saved" };
}

/**
 * Mints a token against the stored credentials.
 *
 * Reports success or Qikink's own message and nothing else — deliberately not
 * the token, the secret, or the raw response, since this returns to a browser.
 */
export async function testQikinkConnection(): Promise<Result> {
  if (!(await requireStaff())) {
    return { ok: false, error: "You do not have permission to do this." };
  }

  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: "Server is not configured for admin writes." };

  const { data } = await supabase
    .from("integration_credentials")
    .select("environment, client_id, client_secret")
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (!data?.client_id || !data.client_secret) {
    return { ok: false, error: "Add a Client ID and Client Secret first." };
  }

  const environment = data.environment as QikinkEnvironment;

  try {
    await testConnection({
      environment,
      clientId: data.client_id,
      clientSecret: data.client_secret,
      enabled: true,
      autoSend: false,
    });
    return { ok: true, message: `Connected to ${HOSTS[environment]}` };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "Could not reach Qikink.",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Test order                                                                  */
/* -------------------------------------------------------------------------- */

export interface TestOrderInput {
  /** "catalogue" = SKU Descriptions + a design; "my_products" = a designed SKU. */
  mode: "catalogue" | "my_products";
  sku: string;
  printTypeId: string;
  designCode: string;
  designUrl: string;
  mockupUrl: string;
  placementSku: string;
  widthInches: string;
  heightInches: string;
  firstName: string;
  lastName: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  zip: string;
  phone: string;
  email: string;
  countryCode: string;
}

/**
 * Sends a one-off order straight to Qikink, bypassing the catalogue.
 *
 * Exists because the two systems can only be proven to talk by actually
 * printing something: a token test says the credentials are valid, but says
 * nothing about whether a SKU resolves, whether the state name is spelled the
 * way Qikink expects, or whether the design URL is reachable from their side.
 * This is the smallest thing that exercises all of that.
 *
 * Not written to `qikink_fulfillments` — it belongs to no order here, and a row
 * with a dangling order_id would be a foreign-key violation anyway.
 */
export async function sendQikinkTestOrder(
  input: TestOrderInput
): Promise<
  Result & {
    orderNumber?: string;
    qikinkOrderId?: string;
    /** Qikink's own status, read back after creating. */
    remoteStatus?: string | null;
    /** Which host it landed on — sandbox orders never appear in the dashboard. */
    host?: string;
  }
> {
  if (!(await requireStaff())) {
    return { ok: false, error: "You do not have permission to do this." };
  }

  const config = await getQikinkConfig();
  if (!config) {
    return { ok: false, error: "Save credentials and switch Qikink on first." };
  }

  const sku = input.sku.trim();
  if (!sku) return { ok: false, error: "Enter a SKU." };

  const catalogue = input.mode === "catalogue";

  if (catalogue && !input.designUrl.trim()) {
    return {
      ok: false,
      error: "A catalogue SKU is a blank garment, so it needs a design URL.",
    };
  }

  const line: QikinkLineItem = catalogue
    ? {
        search_from_my_products: 0,
        sku,
        quantity: "1",
        price: "1",
        print_type_id: Number(input.printTypeId) || 1,
        designs: [
          {
            design_code: input.designCode.trim() || `TEST-${Date.now()}`,
            width_inches: input.widthInches.trim(),
            height_inches: input.heightInches.trim(),
            placement_sku: input.placementSku.trim() || "fr",
            design_link: input.designUrl.trim(),
            // Qikink wants a mockup too; the design stands in when none is given
            // rather than failing a test on a cosmetic field.
            mockup_link: input.mockupUrl.trim() || input.designUrl.trim(),
          },
        ],
      }
    : { search_from_my_products: 1, sku, quantity: "1", price: "1" };

  // Their order_number must never be reused, and a test must not collide with a
  // real order number — a timestamp gives both.
  //
  // Two undocumented constraints shape the format, both found by hitting them:
  // it is capped at 15 characters ("Order no. cannot exceed 15 chars") and must
  // be alphanumeric ("Order No cannot contain special characters" — a hyphen is
  // enough to trip it). So: no separator, and base 36 to keep the timestamp
  // short. `TEST` + 8 chars = 12, and stays inside the cap past the year 4000.
  const orderNumber = `TEST${Date.now().toString(36).toUpperCase()}`;

  try {
    const result = await createOrder(config, {
      order_number: orderNumber,
      qikink_shipping: "1",
      gateway: "Prepaid",
      total_order_value: "1",
      line_items: [line],
      shipping_address: {
        first_name: input.firstName.trim(),
        // Sent even when blank; Qikink dies on the missing key, not the empty
        // value. Same for address2.
        last_name: input.lastName.trim(),
        address1: input.address1.trim(),
        address2: input.address2.trim(),
        phone: input.phone.trim(),
        email: input.email.trim(),
        city: input.city.trim(),
        zip: input.zip.trim(),
        province: input.province.trim(),
        country_code: input.countryCode.trim().toUpperCase() || "IN",
      },
    });

    const qikinkOrderId = result.order_id != null ? String(result.order_id) : "";

    // Read it straight back. "Accepted" is Qikink's word for the request, not
    // proof the order exists — and since a sandbox order is invisible in the
    // dashboard, this round trip is the only way to actually see it landed.
    let remoteStatus: string | null = null;
    if (qikinkOrderId) {
      try {
        const remote = await fetchOrder(config, qikinkOrderId);
        remoteStatus = remote?.status ?? null;
      } catch {
        // Not a failure of the send. Leaving it null makes the UI say the order
        // was created but could not be read back, which is the honest report.
      }
    }

    return {
      ok: true,
      message: qikinkOrderId
        ? `Qikink accepted it — their order id is ${qikinkOrderId}`
        : "Qikink accepted the request.",
      orderNumber,
      qikinkOrderId,
      remoteStatus,
      host: HOSTS[config.environment],
    };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "Could not reach Qikink.",
    };
  }
}
