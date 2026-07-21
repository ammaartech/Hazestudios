import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  Collection,
  InventoryLevel,
  Location,
  Product,
  ProductImage,
  ProductOption,
  ProductVariant,
} from "@/lib/types";
import { ProductForm, type ProductFormInitial } from "../product-form";

export const metadata = { title: "Edit product" };
export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: product },
    { data: images },
    { data: options },
    { data: variants },
    { data: memberships },
    { data: inventory },
    { data: collections },
    { data: locations },
  ] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).single(),
    supabase
      .from("product_images")
      .select("*")
      .eq("product_id", id)
      .order("position"),
    supabase
      .from("product_options")
      .select("*")
      .eq("product_id", id)
      .order("position"),
    supabase
      .from("product_variants")
      .select("*")
      .eq("product_id", id)
      .order("position"),
    supabase.from("product_collections").select("collection_id").eq("product_id", id),
    supabase.from("inventory_levels").select("*").eq("product_id", id),
    supabase.from("collections").select("*").order("title"),
    supabase.from("locations").select("*").order("created_at"),
  ]);

  if (!product) notFound();

  const p = product as Product;
  const inventoryLevels = (inventory ?? []) as InventoryLevel[];
  const variantRows = (variants ?? []) as ProductVariant[];

  const initial: ProductFormInitial = {
    id: p.id,
    title: p.title,
    description_html: p.description_html,
    status: p.status,
    vendor: p.vendor,
    product_type: p.product_type,
    tags: p.tags,
    price: Number(p.price),
    compare_at_price: p.compare_at_price != null ? Number(p.compare_at_price) : null,
    cost_per_item: p.cost_per_item != null ? Number(p.cost_per_item) : null,
    sku: p.sku,
    barcode: p.barcode,
    track_inventory: p.track_inventory,
    seo_title: p.seo_title,
    seo_description: p.seo_description,
    images: ((images ?? []) as ProductImage[]).map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt,
    })),
    options: ((options ?? []) as ProductOption[]).map((o) => ({
      name: o.name,
      values: o.values,
    })),
    variants: variantRows.map((v) => ({
      title: v.title,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      price: Number(v.price),
      compare_at_price: v.compare_at_price != null ? Number(v.compare_at_price) : null,
      sku: v.sku,
      barcode: v.barcode,
      quantity: inventoryLevels
        .filter((l) => l.variant_id === v.id)
        .reduce((sum, l) => sum + l.quantity, 0),
    })),
    collection_ids: (memberships ?? []).map((m) => m.collection_id as string),
    inventory: inventoryLevels
      .filter((l) => l.variant_id === null)
      .map((l) => ({ location_id: l.location_id, quantity: l.quantity })),
  };

  return (
    <ProductForm
      initial={initial}
      collections={(collections ?? []) as Collection[]}
      locations={(locations ?? []) as Location[]}
    />
  );
}
