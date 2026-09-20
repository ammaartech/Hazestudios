"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/staff";

export async function updateOrderDetails(id: string, field: string, value: unknown) {
  const staff = await requireStaff();
  if (!staff.ok) return { error: "You do not have permission to edit orders." };
  const supabase = await createClient();
  const allowed = ["note", "contact", "shipping_address", "billing_address", "metafields"];
  if (!allowed.includes(field)) return { error: "Invalid order field." };
  let patch: Record<string, unknown>;
  if (field === "note") {
    if (typeof value !== "string" || value.length > 5000) return { error: "Notes must be under 5,000 characters." };
    patch = { note: value.trim() };
  } else {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Invalid details." };
    const entries = Object.entries(value);
    if (entries.length > 50 || entries.some(([k, v]) => k.length > 100 || typeof v !== "string" || v.length > 2000)) return { error: "Details are too long." };
    const record = value as Record<string, string>;
    if (field === "contact") {
      if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) return { error: "Enter a valid email address." };
      patch = { email: record.email?.trim() ?? "", phone: record.phone?.trim() ?? "" };
    } else if (field.endsWith("address")) {
      const keys = ["first_name", "last_name", "address1", "address2", "city", "province", "postal_code", "country", "phone"];
      patch = { [field]: Object.fromEntries(keys.map(k => [k, record[k]?.trim() ?? ""])) };
    } else patch = { metafields: record };
  }
  const { data, error } = await supabase.from("orders").update(patch).eq("id", id).select("id").single();
  if (error || !data) return { error: error?.message ?? "Order could not be saved." };
  revalidatePath(`/admin/orders/${id}`);
  return { ok: true };
}
