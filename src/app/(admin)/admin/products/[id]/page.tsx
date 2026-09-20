import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  InventoryLevel,
  Product,
  ProductImage,
  ProductOption,
  ProductVariant,
} from "@/lib/types";
import { geminiConfigured } from "@/lib/ai/gemini";
import {
  getCollectionOptions,
  getLocations,
  getProductFacets,
  getShopCurrency,
} from "@/lib/admin/reference";
import { draftFromProduct } from "../draft-mapping";
import { ProductForm } from "../product-form";

/** The product and every child row, as one PostgREST request. */
const PRODUCT_COLUMNS =
  "*, product_images(*), product_options(*), product_variants(*), product_collections(collection_id), inventory_levels(*)";

type ProductRecord = Product & {
  product_images: ProductImage[];
  product_options: ProductOption[];
  product_variants: ProductVariant[];
  product_collections: { collection_id: string }[];
  inventory_levels: InventoryLevel[];
};

/**
 * Memoised per request so `generateMetadata` and the page — which Next runs
 * concurrently — share one read instead of each paying for their own.
 */
const loadProduct = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as ProductRecord | null) ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await loadProduct(id);
  return { title: product?.title ?? "Edit product" };
}

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // This page used to issue ten requests to Tokyo: the product and five child
  // tables one by one, plus collections, locations, settings and facets. The
  // children now ride along as embedded resources in the product read, and
  // the other four are shop-wide reference data from the shared cache — so
  // the common path is one database round trip.
  const [record, collections, locations, currency, facets] = await Promise.all([
    loadProduct(id),
    getCollectionOptions(),
    getLocations(),
    getShopCurrency(),
    getProductFacets(),
  ]);

  if (!record) notFound();
  const {
    product_images,
    product_options,
    product_variants,
    product_collections,
    inventory_levels,
    ...product
  } = record;

  // Embedded rows come back in table order; the editor relies on position.
  const byPosition = <T extends { position: number }>(rows: T[]) =>
    [...rows].sort((a, b) => a.position - b.position);

  const initial = draftFromProduct({
    product: product as Product,
    images: byPosition(product_images),
    options: byPosition(product_options),
    variants: byPosition(product_variants),
    inventory: inventory_levels,
    collectionIds: product_collections.map((m) => m.collection_id),
    locations,
  });

  return (
    <ProductForm
      // Remount on a different product rather than trying to reconcile one
      // draft store onto another record's data.
      key={id}
      initial={initial}
      collections={collections}
      locations={locations}
      facets={facets}
      currency={currency}
      aiEnabled={geminiConfigured()}
    />
  );
}
