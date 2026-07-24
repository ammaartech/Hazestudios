import { CollectionForm } from "../collection-form";
import { draftFromCollection } from "../collection-draft";
import { getPickerProducts } from "../collection-data";

export const metadata = { title: "Add collection" };
export const dynamic = "force-dynamic";

export default async function NewCollectionPage() {
  const products = await getPickerProducts();

  return (
    <CollectionForm initial={draftFromCollection(null, [])} products={products} />
  );
}
