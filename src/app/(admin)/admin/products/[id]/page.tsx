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
  ShopSettings,
} from "@/lib/types";
import { getProductFacets } from "../actions";
import { draftFromProduct } from "../draft-mapping";
import { ProductForm } from "../product-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("title")
    .eq("id", id)
    .maybeSingle();
  return { title: data?.title ?? "Edit product" };
}

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
    { data: settings },
    facets,
  ] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase.from("product_images").select("*").eq("product_id", id).order("position"),
    supabase.from("product_options").select("*").eq("product_id", id).order("position"),
    supabase.from("product_variants").select("*").eq("product_id", id).order("position"),
    supabase.from("product_collections").select("collection_id").eq("product_id", id),
    supabase.from("inventory_levels").select("*").eq("product_id", id),
    supabase.from("collections").select("*").order("title"),
    supabase.from("locations").select("*").order("created_at"),
    supabase.from("shop_settings").select("currency, store_name").single(),
    getProductFacets(),
  ]);

  if (!product) notFound();

  const shop = settings as Pick<ShopSettings, "currency" | "store_name"> | null;
  const locationRows = (locations ?? []) as Location[];

  const initial = draftFromProduct({
    product: product as Product,
    images: (images ?? []) as ProductImage[],
    options: (options ?? []) as ProductOption[],
    variants: (variants ?? []) as ProductVariant[],
    inventory: (inventory ?? []) as InventoryLevel[],
    collectionIds: (memberships ?? []).map((m) => m.collection_id as string),
    locations: locationRows,
  });

  return (
    <ProductForm
      // Remount on a different product rather than trying to reconcile one
      // draft store onto another record's data.
      key={id}
      initial={initial}
      collections={(collections ?? []) as Collection[]}
      locations={locationRows}
      facets={facets}
      currency={shop?.currency ?? "USD"}
    />
  );
}
