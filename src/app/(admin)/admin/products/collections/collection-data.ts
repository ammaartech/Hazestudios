import { createClient } from "@/lib/supabase/server";
import type { Product, ProductImage } from "@/lib/types";
import type { PickerProduct } from "./collection-items";

type ProductRow = Product & {
  product_images: Pick<ProductImage, "url" | "position">[];
};

/**
 * Every product, flattened for the collection editor.
 *
 * Deliberately unfiltered by status: a draft product can legitimately be staged
 * into a collection ahead of a drop, and hiding it here would make the
 * arrangement impossible to prepare. The storefront filters on status at read
 * time, so a draft in a collection stays invisible to shoppers either way.
 */
export async function getPickerProducts(): Promise<PickerProduct[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*, product_images(url, position)")
    .order("title");

  return ((data ?? []) as ProductRow[]).map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    price: Number(p.price),
    vendor: p.vendor,
    product_type: p.product_type,
    tags: p.tags,
    cover:
      [...p.product_images].sort((a, b) => a.position - b.position)[0]?.url ??
      null,
  }));
}
