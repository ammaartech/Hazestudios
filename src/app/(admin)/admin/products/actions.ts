"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ProductStatus } from "@/lib/types";

export interface OptionPayload {
  name: string;
  values: string[];
}

export interface VariantPayload {
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price: number;
  compare_at_price: number | null;
  sku: string;
  barcode: string;
  quantity: number;
}

export interface ImagePayload {
  url: string;
  alt: string;
}

export interface ProductPayload {
  id?: string;
  title: string;
  description_html: string;
  status: ProductStatus;
  vendor: string;
  product_type: string;
  tags: string[];
  price: number;
  compare_at_price: number | null;
  cost_per_item: number | null;
  sku: string;
  barcode: string;
  track_inventory: boolean;
  seo_title: string;
  seo_description: string;
  images: ImagePayload[];
  options: OptionPayload[];
  variants: VariantPayload[];
  collection_ids: string[];
  /** simple-product stock per location */
  inventory: { location_id: string; quantity: number }[];
}

export async function saveProduct(payload: ProductPayload) {
  const supabase = await createClient();

  if (!payload.title.trim()) {
    return { error: "Title is required" };
  }

  const hasVariants = payload.options.length > 0 && payload.variants.length > 0;

  const productRow = {
    title: payload.title.trim(),
    description_html: payload.description_html,
    status: payload.status,
    vendor: payload.vendor,
    product_type: payload.product_type,
    tags: payload.tags,
    price: payload.price,
    compare_at_price: payload.compare_at_price,
    cost_per_item: payload.cost_per_item,
    sku: payload.sku,
    barcode: payload.barcode,
    track_inventory: payload.track_inventory,
    has_variants: hasVariants,
    seo_title: payload.seo_title,
    seo_description: payload.seo_description,
  };

  let productId = payload.id;

  if (productId) {
    const { error } = await supabase
      .from("products")
      .update(productRow)
      .eq("id", productId);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase
      .from("products")
      .insert(productRow)
      .select("id")
      .single();
    if (error) return { error: error.message };
    productId = data.id as string;
  }

  // Replace child rows wholesale — simplest consistent write for the admin.
  const cleanup = await Promise.all([
    supabase.from("product_images").delete().eq("product_id", productId),
    supabase.from("product_options").delete().eq("product_id", productId),
    supabase.from("product_variants").delete().eq("product_id", productId),
    supabase.from("product_collections").delete().eq("product_id", productId),
    supabase.from("inventory_levels").delete().eq("product_id", productId),
  ]);
  const cleanupError = cleanup.find((r) => r.error);
  if (cleanupError?.error) return { error: cleanupError.error.message };

  if (payload.images.length) {
    const { error } = await supabase.from("product_images").insert(
      payload.images.map((img, i) => ({
        product_id: productId,
        url: img.url,
        alt: img.alt,
        position: i,
      }))
    );
    if (error) return { error: error.message };
  }

  if (hasVariants) {
    const { error: optError } = await supabase.from("product_options").insert(
      payload.options.map((opt, i) => ({
        product_id: productId,
        name: opt.name,
        values: opt.values,
        position: i,
      }))
    );
    if (optError) return { error: optError.message };

    const { data: variantRows, error: varError } = await supabase
      .from("product_variants")
      .insert(
        payload.variants.map((v, i) => ({
          product_id: productId,
          title: v.title,
          option1: v.option1,
          option2: v.option2,
          option3: v.option3,
          price: v.price,
          compare_at_price: v.compare_at_price,
          sku: v.sku,
          barcode: v.barcode,
          position: i,
        }))
      )
      .select("id");
    if (varError) return { error: varError.message };

    const { data: defaultLocation } = await supabase
      .from("locations")
      .select("id")
      .eq("is_default", true)
      .limit(1)
      .single();

    if (defaultLocation && payload.track_inventory) {
      const { error } = await supabase.from("inventory_levels").insert(
        (variantRows ?? []).map((row, i) => ({
          product_id: productId,
          variant_id: row.id,
          location_id: defaultLocation.id,
          quantity: payload.variants[i]?.quantity ?? 0,
        }))
      );
      if (error) return { error: error.message };
    }
  } else if (payload.track_inventory && payload.inventory.length) {
    const { error } = await supabase.from("inventory_levels").insert(
      payload.inventory.map((lvl) => ({
        product_id: productId,
        variant_id: null,
        location_id: lvl.location_id,
        quantity: lvl.quantity,
      }))
    );
    if (error) return { error: error.message };
  }

  if (payload.collection_ids.length) {
    const { error } = await supabase.from("product_collections").insert(
      payload.collection_ids.map((cid) => ({
        product_id: productId,
        collection_id: cid,
      }))
    );
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/products");
  revalidatePath(`/products/${productId}`);
  return { id: productId };
}

export async function deleteProduct(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function setProductStatus(id: string, status: ProductStatus) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ status })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/products");
  return { ok: true };
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
  if (error) return { error: error.message };
  revalidatePath("/admin/products/inventory");
  return { ok: true };
}
