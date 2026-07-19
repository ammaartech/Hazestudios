"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function generateGiftCardCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) code += "-";
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function issueGiftCard(payload: {
  initial_value: number;
  customer_id: string | null;
  note: string;
  expires_at: string | null;
}) {
  const supabase = await createClient();
  if (payload.initial_value <= 0) return { error: "Value must be positive" };

  const { error } = await supabase.from("gift_cards").insert({
    code: generateGiftCardCode(),
    initial_value: payload.initial_value,
    balance: payload.initial_value,
    customer_id: payload.customer_id,
    note: payload.note,
    expires_at: payload.expires_at,
  });
  if (error) return { error: error.message };

  revalidatePath("/products/gift-cards");
  return { ok: true };
}

export async function toggleGiftCard(id: string, disable: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("gift_cards")
    .update({ disabled_at: disable ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/products/gift-cards");
  return { ok: true };
}
