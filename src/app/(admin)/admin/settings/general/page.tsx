import { getShopSettings } from "@/lib/admin/reference";
import type { ShopSettings } from "@/lib/types";
import { GeneralForm } from "./general-form";

export const metadata = { title: "Store details" };
export default async function GeneralSettingsPage() {
  // From the shared reference cache; the save action expires it on write.
  const data = await getShopSettings();

  return <GeneralForm settings={data as ShopSettings} />;
}
