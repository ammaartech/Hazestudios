import { getQikinkStatus } from "@/lib/qikink/config";
import { QikinkForm } from "./qikink-form";

export const metadata = { title: "Qikink" };
export const dynamic = "force-dynamic";

/**
 * `getQikinkStatus` returns the redacted view — client id, flags, and a boolean
 * for whether a secret exists. The secret itself is never read here, because
 * anything this component returns is serialised into the page sent to the
 * browser.
 */
export default async function QikinkSettingsPage() {
  const status = await getQikinkStatus();
  return <QikinkForm status={status} />;
}
