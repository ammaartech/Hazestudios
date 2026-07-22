"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SegmentFilter } from "@/lib/types";

export interface CustomerPayload {
  id?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  notes: string;
  tags: string[];
  accepts_marketing: boolean;
  default_address: Record<string, string>;
}

export async function saveCustomer(payload: CustomerPayload) {
  const supabase = await createClient();

  if (!payload.first_name.trim() && !payload.email.trim()) {
    return { error: "A name or email is required" };
  }

  const row = {
    first_name: payload.first_name.trim(),
    last_name: payload.last_name.trim(),
    email: payload.email.trim() || null,
    phone: payload.phone.trim() || null,
    notes: payload.notes,
    tags: payload.tags,
    accepts_marketing: payload.accepts_marketing,
    default_address: payload.default_address,
  };

  if (payload.id) {
    const { error } = await supabase
      .from("customers")
      .update(row)
      .eq("id", payload.id);
    if (error) return { error: error.message };
    revalidatePath(`/customers/${payload.id}`);
    revalidatePath("/admin/customers");
    return { id: payload.id };
  }

  const { data, error } = await supabase
    .from("customers")
    .insert(row)
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/admin/customers");
  return { id: data.id as string };
}

export async function deleteCustomer(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/customers");
  return { ok: true };
}

export async function saveSegment(payload: {
  id?: string;
  name: string;
  filters: SegmentFilter[];
}) {
  const supabase = await createClient();
  if (!payload.name.trim()) return { error: "Name is required" };

  if (payload.id) {
    const { error } = await supabase
      .from("segments")
      .update({ name: payload.name.trim(), filters: payload.filters })
      .eq("id", payload.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("segments")
      .insert({ name: payload.name.trim(), filters: payload.filters });
    if (error) return { error: error.message };
  }
  revalidatePath("/admin/customers/segments");
  return { ok: true };
}

export async function deleteSegment(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("segments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/customers/segments");
  return { ok: true };
}
