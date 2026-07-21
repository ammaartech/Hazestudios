import { createClient } from "@/lib/supabase/server";
import type { ShopSettings } from "@/lib/types";
import { PoliciesForm } from "./policies-form";

export const metadata = { title: "Policies" };
export const dynamic = "force-dynamic";

export default async function PoliciesSettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shop_settings")
    .select("*")
    .eq("id", 1)
    .single();

  return <PoliciesForm settings={data as ShopSettings} />;
}
