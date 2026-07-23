"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ProductStatus, WeightUnit } from "@/lib/types";

export interface ImagePayload {
  id: string;
  url: string;
  alt: string;
}

export interface OptionPayload {
  name: string;
  values: string[];
}

export interface InventoryPayload {
  location_id: string;
  quantity: number;
}

export interface VariantPayload {
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price: number;
  compare_at_price: number | null;
  cost_per_item: number | null;
  sku: string;
  barcode: string;
  weight: number | null;
  weight_unit: WeightUnit;
  requires_shipping: boolean;
  track_inventory: boolean;
  continue_selling: boolean;
  available: boolean;
  image_id: string | null;
  inventory: InventoryPayload[];
}

export interface ProductPayload {
  id: string | null;
  title: string;
  handle: string;
  description_html: string;
  status: ProductStatus;
  vendor: string;
  product_type: string;
  category: string;
  tags: string[];
  price: number;
  compare_at_price: number | null;
  cost_per_item: number | null;
  sku: string;
  barcode: string;
  track_inventory: boolean;
  continue_selling: boolean;
  requires_shipping: boolean;
  weight: number | null;
  weight_unit: WeightUnit;
  country_of_origin: string;
  hs_code: string;
  seo_title: string;
  seo_description: string;
  published_at: string | null;
  images: ImagePayload[];
  options: OptionPayload[];
  variants: VariantPayload[];
  inventory: InventoryPayload[];
  collection_ids: string[];
}

export type SaveResult =
  | { ok: true; id: string; handle: string }
  | { ok: false; error: string };

/** Turn a Postgres error into something an operator can act on. */
function readableError(message: string): string {
  if (message.includes("products_handle_key")) {
    return "That URL handle is already taken by another product.";
  }
  if (message.includes("Title is required")) {
    return "Title is required.";
  }
  if (message.includes("products_weight_unit_check")) {
    return "Weight unit must be kg, g, lb, or oz.";
  }
  if (message.includes("not found")) {
    return "This product no longer exists. It may have been deleted in another tab.";
  }
  return message;
}

function revalidateProduct(id: string, handle: string) {
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/admin/products/inventory");
  revalidatePath(`/products/${handle}`);
  revalidatePath("/");
}

/**
 * One round trip, one transaction. `save_product` upserts the product and every
 * child table together, so a failure anywhere leaves the record exactly as it
 * was rather than half-written.
 */
export async function saveProduct(payload: ProductPayload): Promise<SaveResult> {
  if (!payload.title.trim()) {
    return { ok: false, error: "Title is required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_product", { payload });

  if (error) return { ok: false, error: readableError(error.message) };

  const result = data as { id: string; handle: string };
  revalidateProduct(result.id, result.handle);
  return { ok: true, id: result.id, handle: result.handle };
}

export async function duplicateProduct(
  id: string,
  title?: string
): Promise<SaveResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_product", {
    source_id: id,
    new_title: title ?? null,
  });

  if (error) return { ok: false, error: readableError(error.message) };

  const result = data as { id: string; handle: string };
  revalidatePath("/admin/products");
  return { ok: true, id: result.id, handle: result.handle };
}

export async function deleteProduct(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { ok: false as const, error: readableError(error.message) };
  revalidatePath("/admin/products");
  revalidatePath("/");
  return { ok: true as const };
}

export async function setProductStatus(id: string, status: ProductStatus) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({
      status,
      // Publishing stamps the date; unpublishing clears it, so "published on"
      // never shows a date for a product that is not live.
      published_at: status === "active" ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("handle")
    .single();

  if (error) return { ok: false as const, error: readableError(error.message) };
  revalidateProduct(id, data.handle as string);
  return { ok: true as const };
}

/** Bulk status change from the products list selection. */
export async function setProductStatusBulk(ids: string[], status: ProductStatus) {
  if (!ids.length) return { ok: true as const, count: 0 };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("products")
    .update(
      {
        status,
        published_at: status === "active" ? new Date().toISOString() : null,
      },
      { count: "exact" }
    )
    .in("id", ids);

  if (error) return { ok: false as const, error: readableError(error.message) };
  revalidatePath("/admin/products");
  revalidatePath("/");
  return { ok: true as const, count: count ?? ids.length };
}

export async function deleteProductBulk(ids: string[]) {
  if (!ids.length) return { ok: true as const, count: 0 };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("products")
    .delete({ count: "exact" })
    .in("id", ids);

  if (error) return { ok: false as const, error: readableError(error.message) };
  revalidatePath("/admin/products");
  revalidatePath("/");
  return { ok: true as const, count: count ?? ids.length };
}

export async function adjustInventory(
  productId: string,
  locationId: string,
  variantId: string | null,
  quantity: number
) {
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_levels").upsert(
    {
      product_id: productId,
      variant_id: variantId,
      location_id: locationId,
      quantity,
    },
    { onConflict: "product_id,variant_id,location_id" }
  );
  if (error) return { ok: false as const, error: readableError(error.message) };
  revalidatePath("/admin/products/inventory");
  return { ok: true as const };
}

export interface ProductFacets {
  tags: string[];
  vendors: string[];
  types: string[];
  categories: string[];
}

/** Autocomplete sources for the Organization card. */
export async function getProductFacets(): Promise<ProductFacets> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("product_facets");
  if (error || !data) return { tags: [], vendors: [], types: [], categories: [] };
  return data as ProductFacets;
}
