import { getShopSettings } from "@/lib/admin/reference";
import type { ShopSettings } from "@/lib/types";
import { BrandForm } from "./brand-form";

export const metadata = { title: "Brand" };
export default async function BrandSettingsPage() {
  // From the shared reference cache; the save action expires it on write.
  const data = await getShopSettings();

  return <BrandForm settings={data as ShopSettings} />;
}
