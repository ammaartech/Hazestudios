import { createClient } from "@/lib/supabase/server";
import { CollectionForm } from "../collection-form";

export const metadata = { title: "Create collection" };
export const dynamic = "force-dynamic";

export default async function NewCollectionPage() {
  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, title, status")
    .order("title");

  return (
    <CollectionForm
      initial={{
        title: "",
        description: "",
        type: "manual",
        rules: [],
        product_ids: [],
      }}
      products={products ?? []}
    />
  );
}
