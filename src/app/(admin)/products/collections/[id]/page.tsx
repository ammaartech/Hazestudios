import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Collection } from "@/lib/types";
import { CollectionForm } from "../collection-form";

export const metadata = { title: "Edit collection" };
export const dynamic = "force-dynamic";

export default async function EditCollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: collection }, { data: memberships }, { data: products }] =
    await Promise.all([
      supabase.from("collections").select("*").eq("id", id).single(),
      supabase
        .from("product_collections")
        .select("product_id")
        .eq("collection_id", id),
      supabase.from("products").select("id, title, status").order("title"),
    ]);

  if (!collection) notFound();
  const c = collection as Collection;

  return (
    <CollectionForm
      initial={{
        id: c.id,
        title: c.title,
        description: c.description,
        type: c.type,
        rules: c.rules,
        product_ids: (memberships ?? []).map((m) => m.product_id as string),
      }}
      products={products ?? []}
    />
  );
}
