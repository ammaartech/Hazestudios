import { createClient } from "@/lib/supabase/server";
import type { Collection, Location, ShopSettings } from "@/lib/types";
import { getProductFacets } from "../actions";
import { emptyDraft } from "../draft-mapping";
import { ProductForm } from "../product-form";

export const metadata = { title: "Add product" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const supabase = await createClient();
  const [{ data: collections }, { data: locations }, { data: settings }, facets] =
    await Promise.all([
      supabase.from("collections").select("*").order("title"),
      supabase.from("locations").select("*").order("created_at"),
      supabase.from("shop_settings").select("currency, store_name").single(),
      getProductFacets(),
    ]);

  const shop = settings as Pick<ShopSettings, "currency" | "store_name"> | null;

  return (
    <ProductForm
      initial={emptyDraft}
      collections={(collections ?? []) as Collection[]}
      locations={(locations ?? []) as Location[]}
      facets={facets}
      currency={shop?.currency ?? "USD"}
    />
  );
}
