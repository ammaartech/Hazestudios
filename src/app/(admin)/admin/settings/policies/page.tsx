import { getShopSettings } from "@/lib/admin/reference";
import type { ShopSettings } from "@/lib/types";
import { PoliciesForm } from "./policies-form";

export const metadata = { title: "Policies" };
export default async function PoliciesSettingsPage() {
  // From the shared reference cache; the save action expires it on write.
  const data = await getShopSettings();

  return <PoliciesForm settings={data as ShopSettings} />;
}
