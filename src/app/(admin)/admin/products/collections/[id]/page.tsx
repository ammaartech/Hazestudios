import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Collection } from "@/lib/types";
import { CollectionForm } from "../collection-form";
import { draftFromCollection } from "../collection-draft";
import { getPickerProducts } from "../collection-data";

export const metadata = { title: "Edit collection" };
export default async function EditCollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: collection }, { data: memberships }, products] =
    await Promise.all([
      supabase.from("collections").select("*").eq("id", id).maybeSingle(),
      // Ordered by position: this is the merchant's arrangement, and loading it
      // unordered would silently reshuffle the collection on the next save.
      supabase
        .from("product_collections")
        .select("product_id, position")
        .eq("collection_id", id)
        .order("position"),
      getPickerProducts(),
    ]);

  if (!collection) notFound();

  return (
    <CollectionForm
      // Remounts the draft store when navigating between collections, so one
      // collection's edits can never bleed into another's.
      key={id}
      initial={draftFromCollection(
        collection as Collection,
        (memberships ?? []).map((m) => m.product_id as string)
      )}
      products={products}
    />
  );
}
