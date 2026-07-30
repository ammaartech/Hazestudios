"use server";

import { revalidatePath } from "next/cache";
import { revalidateCollections } from "@/lib/shop/cache";
import { createClient } from "@/lib/supabase/server";
import { handleize } from "@/lib/format";
import type { CollectionRule, CollectionSort, CollectionType } from "@/lib/types";

export interface CollectionPayload {
  id?: string;
  title: string;
  description: string;
  type: CollectionType;
  rules: CollectionRule[];
  /** Ordered — the array index becomes product_collections.position. */
  product_ids: string[];
  image_url: string | null;
  seo_title: string;
  seo_description: string;
  sort_order: CollectionSort;
  published: boolean;
  /** Explicit, so an edited handle is not clobbered by the title. */
  handle?: string;
}

const SORTS: CollectionSort[] = [
  "manual",
  "alpha_asc",
  "alpha_desc",
  "price_asc",
  "price_desc",
  "created_desc",
  "created_asc",
];

/**
 * Storefront routes are keyed by handle, so a blank or colliding one is a 404
 * rather than a cosmetic problem. Falls back to the title, then disambiguates
 * with a numeric suffix the way the rest of the catalogue does.
 */
async function uniqueHandle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  desired: string,
  excludeId?: string
): Promise<string> {
  const base = handleize(desired) || "collection";
  let candidate = base;

  for (let n = 2; n < 50; n++) {
    let query = supabase.from("collections").select("id").eq("handle", candidate);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query.maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

export async function saveCollection(payload: CollectionPayload) {
  const supabase = await createClient();

  const title = payload.title.trim();
  if (!title) return { error: "Title is required" };

  const sort: CollectionSort = SORTS.includes(payload.sort_order)
    ? payload.sort_order
    : "manual";

  const handle = await uniqueHandle(
    supabase,
    payload.handle?.trim() || title,
    payload.id
  );

  const row = {
    title,
    handle,
    description: payload.description,
    type: payload.type,
    rules: payload.type === "smart" ? payload.rules : [],
    image_url: payload.image_url,
    seo_title: payload.seo_title.trim(),
    seo_description: payload.seo_description.trim(),
    sort_order: sort,
  };

  let collectionId = payload.id;

  if (collectionId) {
    // published_at is a timestamp, not a boolean: publishing stamps now and
    // unpublishing clears it. Saving an already-live collection must not move
    // the stamp, or "published on" would drift with every edit.
    const { data: existing } = await supabase
      .from("collections")
      .select("published_at")
      .eq("id", collectionId)
      .maybeSingle();

    const published_at = payload.published
      ? ((existing?.published_at as string | null) ?? new Date().toISOString())
      : null;

    const { error } = await supabase
      .from("collections")
      .update({ ...row, published_at })
      .eq("id", collectionId);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase
      .from("collections")
      .insert({
        ...row,
        published_at: payload.published ? new Date().toISOString() : null,
      })
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
        // The array index is the merchant's arrangement — this is the only
        // place manual order is persisted.
        payload.product_ids.map((pid, position) => ({
          collection_id: collectionId,
          product_id: pid,
          position,
        }))
      );
      if (error) return { error: error.message };
    }
  }

  revalidateStorefront();
  return { id: collectionId, handle };
}

/**
 * Collections drive the storefront nav, the home page and their own routes, so
 * an edit invalidates more than the page it happened on.
 */
function revalidateStorefront() {
  revalidatePath("/admin/products/collections");
  revalidatePath("/", "layout");
  // The rendered pages above are only half of it: the collection rows and their
  // membership are cached as data too, and the header nav on every storefront
  // route reads them.
  revalidateCollections();
}

export async function deleteCollection(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("collections").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateStorefront();
  return { ok: true };
}

export async function deleteCollectionBulk(ids: string[]) {
  if (!ids.length) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase.from("collections").delete().in("id", ids);
  if (error) return { ok: false, error: error.message };
  revalidateStorefront();
  return { ok: true };
}

/** Bulk publish / unpublish from the list's selection toolbar. */
export async function setCollectionPublishedBulk(
  ids: string[],
  published: boolean
) {
  if (!ids.length) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase
    .from("collections")
    .update({ published_at: published ? new Date().toISOString() : null })
    .in("id", ids);
  if (error) return { ok: false, error: error.message };
  revalidateStorefront();
  return { ok: true };
}
