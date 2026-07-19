"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ShopSettings, StaffRole } from "@/lib/types";

export async function updateShopSettings(
  patch: Partial<
    Pick<
      ShopSettings,
      | "store_name"
      | "legal_name"
      | "email"
      | "phone"
      | "currency"
      | "timezone"
      | "address"
      | "brand"
      | "policies"
    >
  >
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("shop_settings")
    .update(patch)
    .eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/settings", "layout");
  return { ok: true };
}

export async function saveLocation(payload: {
  id?: string;
  name: string;
  address: Record<string, string>;
  is_default: boolean;
}) {
  const supabase = await createClient();
  if (!payload.name.trim()) return { error: "Name is required" };

  if (payload.is_default) {
    await supabase
      .from("locations")
      .update({ is_default: false })
      .eq("is_default", true);
  }

  if (payload.id) {
    const { error } = await supabase
      .from("locations")
      .update({
        name: payload.name.trim(),
        address: payload.address,
        is_default: payload.is_default,
      })
      .eq("id", payload.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("locations").insert({
      name: payload.name.trim(),
      address: payload.address,
      is_default: payload.is_default,
    });
    if (error) return { error: error.message };
  }
  revalidatePath("/settings/locations");
  return { ok: true };
}

export async function deleteLocation(id: string) {
  const supabase = await createClient();
  const { data: location } = await supabase
    .from("locations")
    .select("is_default")
    .eq("id", id)
    .single();
  if (location?.is_default) {
    return { error: "The default location cannot be deleted" };
  }
  const { error } = await supabase.from("locations").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/settings/locations");
  return { ok: true };
}

export async function updateStaffRole(userId: string, role: StaffRole) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: me } = await supabase
    .from("staff_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (me?.role !== "owner" && me?.role !== "admin") {
    return { error: "Only owners and admins can change roles" };
  }
  if (userId === user.id) {
    return { error: "You cannot change your own role" };
  }

  const { error } = await supabase
    .from("staff_roles")
    .update({ role })
    .eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath("/settings/users");
  return { ok: true };
}
