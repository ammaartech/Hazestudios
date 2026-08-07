import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/page-header";
import { createClient } from "@/lib/supabase/server";
import type {
  InventoryLevel,
  Location,
  Product,
  ProductVariant,
} from "@/lib/types";
import { InventoryGrid, type InventoryRow } from "./inventory-grid";

export const metadata = { title: "Inventory" };

// The grid joins these in memory, so each query names just the fields the rows
// are built from — full product rows (descriptions, SEO, …) never leave the DB.
type ProductRow = Pick<Product, "id" | "title" | "sku" | "has_variants">;
type VariantRow = Pick<ProductVariant, "id" | "product_id" | "title" | "sku">;
type LevelRow = Pick<
  InventoryLevel,
  "product_id" | "variant_id" | "location_id" | "quantity"
>;

export default async function InventoryPage() {
  const supabase = await createClient();
  const [
    { data: productsData },
    { data: variantsData },
    { data: levelsData },
    { data: locationsData },
  ] = await Promise.all([
    supabase
      .from("products")
      .select("id, title, sku, has_variants")
      .eq("track_inventory", true)
      .neq("status", "archived")
      .order("title"),
    supabase
      .from("product_variants")
      .select("id, product_id, title, sku")
      .order("position"),
    supabase
      .from("inventory_levels")
      .select("product_id, variant_id, location_id, quantity"),
    supabase.from("locations").select("id, name").order("created_at"),
  ]);

  const products = (productsData ?? []) as ProductRow[];
  const variants = (variantsData ?? []) as VariantRow[];
  const levels = (levelsData ?? []) as LevelRow[];
  const locations = (locationsData ?? []) as Pick<Location, "id" | "name">[];

  const rows: InventoryRow[] = [];
  for (const p of products) {
    const productVariants = variants.filter((v) => v.product_id === p.id);
    if (p.has_variants && productVariants.length) {
      for (const v of productVariants) {
        rows.push({
          productId: p.id,
          variantId: v.id,
          label: p.title,
          sublabel: v.title,
          sku: v.sku,
          quantities: Object.fromEntries(
            levels
              .filter((l) => l.variant_id === v.id)
              .map((l) => [l.location_id, l.quantity])
          ),
        });
      }
    } else {
      rows.push({
        productId: p.id,
        variantId: null,
        label: p.title,
        sublabel: "",
        sku: p.sku,
        quantities: Object.fromEntries(
          levels
            .filter((l) => l.product_id === p.id && l.variant_id === null)
            .map((l) => [l.location_id, l.quantity])
        ),
      });
    }
  }

  return (
    <div>
      <PageHeader title="Inventory" />
      <Card>
        <CardContent className="pt-0">
          {rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No tracked products yet. Enable “Track quantity” on a product to
              manage its stock here.
            </p>
          ) : (
            <InventoryGrid rows={rows} locations={locations} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
