import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCourierStatus } from "@/lib/couriers/config";
import { parsePackageDefaults, parsePickupAddress } from "@/lib/couriers/draft";
import { BlueDartForm } from "./bluedart-form";
import { PickupForm } from "./pickup-form";
import { ShreeMarutiForm } from "./shreemaruti-form";

export const metadata = { title: "Shipping and delivery" };

/**
 * Where parcels ship from, and which couriers can be booked.
 *
 * `getCourierStatus` returns the redacted view of each courier — ids, flags,
 * and a boolean per secret. No secret is read here, because anything this
 * component returns is serialised into the page sent to the browser. The
 * pickup profile is not secret and is passed whole.
 *
 * The origin is resolved here for the webhook URL, the same way the Payments
 * page does it, so it is right on the first paint rather than filled in by an
 * effect.
 */
export default async function ShippingSettingsPage() {
  const supabase = createAdminClient();
  const [shreemaruti, bluedart, headerList, profile] = await Promise.all([
    getCourierStatus("shreemaruti"),
    getCourierStatus("bluedart"),
    headers(),
    supabase
      ? supabase.from("courier_settings").select("pickup, return_address, package_defaults").eq("id", true).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || (host ? `${proto}://${host}` : "");

  return (
    <div className="space-y-5">
      <PickupForm
        pickup={parsePickupAddress(profile.data?.pickup)}
        returnAddress={parsePickupAddress(profile.data?.return_address)}
        packageDefaults={parsePackageDefaults(profile.data?.package_defaults)}
      />
      <ShreeMarutiForm status={shreemaruti} webhookUrl={origin ? `${origin}/api/webhooks/shreemaruti` : ""} />
      <BlueDartForm status={bluedart} />
    </div>
  );
}
