import { geminiConfigured } from "@/lib/ai/gemini";
import {
  getCollectionOptions,
  getLocations,
  getProductFacets,
  getShopCurrency,
} from "@/lib/admin/reference";
import { emptyDraft } from "../draft-mapping";
import { ProductForm } from "../product-form";

export const metadata = { title: "Add product" };
export default async function NewProductPage() {
  // All four are shop-wide reference data served from the shared cache — no
  // database round trip on the common path.
  const [collections, locations, currency, facets] = await Promise.all([
    getCollectionOptions(),
    getLocations(),
    getShopCurrency(),
    getProductFacets(),
  ]);

  return (
    <ProductForm
      initial={emptyDraft}
      collections={collections}
      locations={locations}
      facets={facets}
      currency={currency}
      aiEnabled={geminiConfigured()}
    />
  );
}
