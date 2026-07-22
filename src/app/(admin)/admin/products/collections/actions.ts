"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { handleize } from "@/lib/format";
import type { CollectionRule, CollectionType } from "@/lib/types";

export interface CollectionPayload {
  id?: string;
  title: string;
  description: string;
  type: CollectionType;
  rules: CollectionRule[];
  product_ids: string[];
}

export async function saveCollection(payload: CollectionPayload) {
  const supabase = await createClient();

  if (!payload.title.trim()) return { error: "Title is required" };

  const row = {
    title: payload.title.trim(),
    handle: handleize(payload.title),
    description: payload.description,
    type: payload.type,
    rules: payload.type === "smart" ? payload.rules : [],
  };

  let collectionId = payload.id;

  if (collectionId) {
    const { error } = await supabase
      .from("collections")
      .update(row)
      .eq("id", collectionId);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase
      .from("collections")
      .insert(row)
      .select("id")
      .single();
    if (error) return { error: error.message };
    collectionId = data.id as string;
  }

  if (payload.type === "manual") {
    const { error: delError } = await supabase
      .from("product_collections")
      .delete()
      .eq("collection_id", collectionId);
    if (delError) return { error: delError.message };

    if (payload.product_ids.length) {
      const { error } = await supabase.from("product_collections").insert(
        payload.product_ids.map((pid) => ({
          collection_id: collectionId,
          product_id: pid,
        }))
      );
      if (error) return { error: error.message };
    }
  }

  revalidatePath("/admin/products/collections");
  return { id: collectionId };
}

export async function deleteCollection(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("collections").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/products/collections");
  return { ok: true };
}
