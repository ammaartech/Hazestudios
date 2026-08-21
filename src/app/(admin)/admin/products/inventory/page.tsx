import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/page-header";
import { Pagination } from "@/components/admin/pagination";
import { SearchInput } from "@/components/admin/search-input";
import { createClient } from "@/lib/supabase/server";
import type {
  InventoryLevel,
  Location,
  Product,
  ProductVariant,
} from "@/lib/types";
import { InventoryGrid, type InventoryRow } from "./inventory-grid";

export const metadata = { title: "Inventory" };

/**
 * Products per page — not rows.
 *
 * A product with variants expands to one row each, so 25 products is roughly
 * 120–150 rows. Sizing the page by rows instead would split a product's
 * variants across a page boundary, which is the one thing this screen must not
 * do: the whole point is seeing a product's sizes side by side.
 */
const PAGE_SIZE = 25;

// The grid joins these in memory, so each query names just the fields the rows
// are built from — full product rows (descriptions, SEO, …) never leave the DB.
type ProductRow = Pick<Product, "id" | "title" | "sku" | "has_variants">;
type VariantRow = Pick<ProductVariant, "id" | "product_id" | "title" | "sku">;
type LevelRow = Pick<
  InventoryLevel,
  "product_id" | "variant_id" | "location_id" | "quantity"
>;

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const supabase = await createClient();
  const page = Math.max(0, parseInt(pageParam ?? "0", 10) || 0);

  /*
   * This page used to load the entire catalogue: every tracked product, all
   * 4,751 variants and every inventory level, unbounded. It then joined them
   * with `variants.filter(...)` inside a loop over products — a linear scan per
   * product, so roughly four million comparisons — and rendered 1,067 rows into
   * 12,800 DOM nodes.
   *
   * Now the page is the unit of work. One page of products is fetched, then
   * only the variants and levels belonging to those products, and the join runs
   * through Maps instead of repeated scans.
   */
  let productQuery = supabase
    .from("products")
    .select("id, title, sku, has_variants", { count: "exact" })
    .eq("track_inventory", true)
    .neq("status", "archived")
    .order("title")
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  // Without search, pagination would make a specific SKU unreachable except by
  // clicking through forty pages.
  if (q) productQuery = productQuery.ilike("title", `%${q}%`);

  const [{ data: productsData, count }, { data: locationsData }] = await Promise.all([
    productQuery,
    supabase.from("locations").select("id, name").order("created_at"),
  ]);

  const products = (productsData ?? []) as ProductRow[];
  const locations = (locationsData ?? []) as Pick<Location, "id" | "name">[];
  const productIds = products.map((p) => p.id);

  // Scoped to this page's products, so both stay proportional to PAGE_SIZE
  // rather than to the catalogue.
  const [{ data: variantsData }, { data: levelsData }] = productIds.length
    ? await Promise.all([
        supabase
          .from("product_variants")
          .select("id, product_id, title, sku")
          .in("product_id", productIds)
          .order("position"),
        supabase
          .from("inventory_levels")
          .select("product_id, variant_id, location_id, quantity")
          .in("product_id", productIds),
      ])
    : [{ data: [] }, { data: [] }];

  const variants = (variantsData ?? []) as VariantRow[];
  const levels = (levelsData ?? []) as LevelRow[];

  // Indexed once, read many — the nested `filter` calls this replaces were the
  // page's real cost, not the query.
  const variantsByProduct = new Map<string, VariantRow[]>();
  for (const v of variants) {
    const list = variantsByProduct.get(v.product_id);
    if (list) list.push(v);
    else variantsByProduct.set(v.product_id, [v]);
  }

  // Keyed by variant id, or by `p:<product_id>` for a product that has none.
  const quantitiesByKey = new Map<string, Record<string, number>>();
  for (const l of levels) {
    const key = l.variant_id ?? `p:${l.product_id}`;
    const bucket = quantitiesByKey.get(key) ?? {};
    bucket[l.location_id] = l.quantity;
    quantitiesByKey.set(key, bucket);
  }

  const rows: InventoryRow[] = [];
  for (const p of products) {
    const productVariants = variantsByProduct.get(p.id) ?? [];
    if (p.has_variants && productVariants.length) {
      for (const v of productVariants) {
        rows.push({
          productId: p.id,
          variantId: v.id,
          label: p.title,
          sublabel: v.title,
          sku: v.sku,
          quantities: quantitiesByKey.get(v.id) ?? {},
        });
      }
    } else {
      rows.push({
        productId: p.id,
        variantId: null,
        label: p.title,
        sublabel: "",
        sku: p.sku,
        quantities: quantitiesByKey.get(`p:${p.id}`) ?? {},
      });
    }
  }

  const total = count ?? 0;

  return (
    <div>
      <PageHeader title="Inventory" />
      <Card>
        <CardContent className="pt-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SearchInput placeholder="Search products" />
            {total > 0 && (
              <p className="text-[13px] text-muted-foreground">
                {total} tracked product{total === 1 ? "" : "s"}
              </p>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {q
                ? `No tracked products match “${q}”.`
                : "No tracked products yet. Enable “Track quantity” on a product to manage its stock here."}
            </p>
          ) : (
            <>
              {/* Keyed on the page so the grid's local edit state starts fresh
                  for a new set of rows rather than carrying the previous
                  page's quantities into it. */}
              <InventoryGrid
                key={`${page}:${q ?? ""}`}
                rows={rows}
                locations={locations}
              />
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
