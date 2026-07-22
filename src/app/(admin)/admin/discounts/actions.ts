"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { DiscountType } from "@/lib/types";

export interface DiscountPayload {
  id?: string;
  code: string;
  type: DiscountType;
  value: number;
  min_purchase: number | null;
  usage_limit: number | null;
  once_per_customer: boolean;
  starts_at: string;
  ends_at: string | null;
}

export async function saveDiscount(payload: DiscountPayload) {
  const supabase = await createClient();

  if (!payload.code.trim()) return { error: "Code is required" };
  if (
    (payload.type === "percentage" || payload.type === "fixed") &&
    payload.value <= 0
  ) {
    return { error: "Value must be greater than zero" };
  }
  if (payload.type === "percentage" && payload.value > 100) {
    return { error: "Percentage cannot exceed 100" };
  }

  const now = new Date();
  const starts = new Date(payload.starts_at);
  const ends = payload.ends_at ? new Date(payload.ends_at) : null;
  const status =
    starts > now ? "scheduled" : ends && ends < now ? "expired" : "active";

  const row = {
    code: payload.code.trim().toUpperCase(),
    type: payload.type,
    value: payload.value,
    min_purchase: payload.min_purchase,
    usage_limit: payload.usage_limit,
    once_per_customer: payload.once_per_customer,
    starts_at: payload.starts_at,
    ends_at: payload.ends_at,
    status,
  };

  if (payload.id) {
    const { error } = await supabase
      .from("discounts")
      .update(row)
      .eq("id", payload.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("discounts").insert(row);
    if (error) {
      return {
        error: error.message.includes("duplicate")
          ? "A discount with this code already exists"
          : error.message,
      };
    }
  }

  revalidatePath("/admin/discounts");
  return { ok: true };
}

export async function toggleDiscount(id: string, disable: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("discounts")
    .update({ status: disable ? "disabled" : "active" })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/discounts");
  return { ok: true };
}

export async function deleteDiscount(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("discounts").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/discounts");
  return { ok: true };
}
