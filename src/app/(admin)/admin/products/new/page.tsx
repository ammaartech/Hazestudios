import { createClient } from "@/lib/supabase/server";
import type { Collection, Location } from "@/lib/types";
import { ProductForm, emptyProduct } from "../product-form";

export const metadata = { title: "Add product" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const supabase = await createClient();
  const [{ data: collections }, { data: locations }] = await Promise.all([
    supabase.from("collections").select("*").order("title"),
    supabase.from("locations").select("*").order("created_at"),
  ]);

  return (
    <ProductForm
      initial={emptyProduct}
      collections={(collections ?? []) as Collection[]}
      locations={(locations ?? []) as Location[]}
    />
  );
}
