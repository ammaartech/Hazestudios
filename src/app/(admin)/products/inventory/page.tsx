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
export const dynamic = "force-dynamic";

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
      .select("*")
      .eq("track_inventory", true)
      .neq("status", "archived")
      .order("title"),
    supabase.from("product_variants").select("*").order("position"),
    supabase.from("inventory_levels").select("*"),
    supabase.from("locations").select("*").order("created_at"),
  ]);

  const products = (productsData ?? []) as Product[];
  const variants = (variantsData ?? []) as ProductVariant[];
  const levels = (levelsData ?? []) as InventoryLevel[];
  const locations = (locationsData ?? []) as Location[];

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
