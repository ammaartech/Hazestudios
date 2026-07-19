import { createClient } from "@/lib/supabase/server";
import type { ShopSettings } from "@/lib/types";
import { BrandForm } from "./brand-form";

export const metadata = { title: "Brand" };
export const dynamic = "force-dynamic";

export default async function BrandSettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shop_settings")
    .select("*")
    .eq("id", 1)
    .single();

  return <BrandForm settings={data as ShopSettings} />;
}
