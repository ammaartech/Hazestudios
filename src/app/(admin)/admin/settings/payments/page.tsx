import { headers } from "next/headers";
import { getCashfreeStatus } from "@/lib/cashfree/config";
import { CashfreeForm } from "./cashfree-form";

export const metadata = { title: "Payments" };

/**
 * `getCashfreeStatus` returns the redacted view — App ID, flags, and a boolean
 * for whether a secret exists. The Secret Key itself is never read here,
 * because anything this component returns is serialised into the page sent to
 * the browser.
 *
 * The origin is resolved here rather than from `window.location` in the form,
 * so the webhook URL is correct in the first paint rather than filled in by an
 * effect. `headers()` is safe in this page: the admin layout already renders
 * `children` inside its own Suspense boundary, which is what Cache Components
 * requires of request-time data.
 */
export default async function PaymentsSettingsPage() {
  const [status, headerList] = await Promise.all([
    getCashfreeStatus(),
    headers(),
  ]);

  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto =
    headerList.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");

  return (
    <CashfreeForm
      status={status}
      webhookUrl={host ? `${proto}://${host}/api/webhooks/cashfree` : ""}
    />
  );
}
