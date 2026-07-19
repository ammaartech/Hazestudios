import { createClient } from "@/lib/supabase/server";
import type { ShopSettings } from "@/lib/types";
import { GeneralForm } from "./general-form";

export const metadata = { title: "Store details" };
export const dynamic = "force-dynamic";

export default async function GeneralSettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shop_settings")
    .select("*")
    .eq("id", 1)
    .single();

  return <GeneralForm settings={data as ShopSettings} />;
}
