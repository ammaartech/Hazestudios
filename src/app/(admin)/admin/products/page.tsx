import Link from "next/link";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/page-header";
import { Pagination } from "@/components/admin/pagination";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import type { Product, ProductImage } from "@/lib/types";
import { ProductListActions } from "./product-list-actions";
import { ProductsTable, type ProductListRow } from "./products-table";

export const metadata = { title: "Products" };

const PAGE_SIZE = 50;

/** One page of list rows — the table's columns plus what the flattening needs. */
type ProductRow = Pick<
  Product,
  | "id"
  | "title"
  | "status"
  | "category"
  | "product_type"
  | "vendor"
  | "price"
  | "track_inventory"
> & {
  product_images: Pick<ProductImage, "url" | "position">[];
  inventory_levels: { quantity: number }[];
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const { status, q, page: pageParam } = await searchParams;
  const supabase = await createClient();

  const page = Math.max(0, parseInt(pageParam ?? "0", 10) || 0);

  // The table used to page client-side over every row in the catalog, which
  // still shipped the whole catalog on each visit (and PostgREST caps the
  // response at 1,000 rows anyway). One `range` page + an exact count is both
  // lighter and correct at any size.
  let query = supabase
    .from("products")
    .select(
      "id, title, status, category, product_type, vendor, price, track_inventory, product_images(url, position), inventory_levels(quantity)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (status && ["active", "draft", "archived"].includes(status)) {
    query = query.eq("status", status);
  }
  if (q) {
    query = query.ilike("title", `%${q}%`);
  }

  const [{ data, count }, { data: shop }] = await Promise.all([
    query,
    supabase.from("shop_settings").select("currency").single(),
  ]);
  const products = (data ?? []) as ProductRow[];
  const total = count ?? 0;

  // Flatten each row so the client table stays a pure renderer.
  const rows: ProductListRow[] = products.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    category: p.category,
    product_type: p.product_type,
    vendor: p.vendor,
    price: p.price,
    track_inventory: p.track_inventory,
    cover:
      [...p.product_images].sort((a, b) => a.position - b.position)[0]?.url ?? null,
    stock: p.inventory_levels.reduce((sum, l) => sum + l.quantity, 0),
  }));

  return (
    // Full-bleed: a nine-column product table needs the width, and capping it at
    // max-w-6xl was what forced the columns apart. The layout zeroes its padding
    // for `data-full-bleed`, so the page restates the gutter itself — same
    // convention the analytics dashboards use.
    <div data-full-bleed className="px-4 py-6 md:px-8 lg:py-8">
      <PageHeader title="Products">
        <ProductListActions currency={shop?.currency ?? "INR"} />
        {/* size="sm" to sit level with the ProductListActions buttons beside it;
            the default h-8 made the primary CTA 4px taller than its row. */}
        <Button asChild size="sm">
          <Link href="/admin/products/new">Add product</Link>
        </Button>
      </PageHeader>

      <ProductInsights />

      <Card>
        <CardContent>
          <ProductsTable products={rows} status={status} />
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}

/** The three merchandising summary tiles above the list. */
function ProductInsights() {
  const tiles = [
    { label: "Average sell-through rate", value: "0%", note: "—" },
    { label: "Products by days of inventory remaining", value: "No data", note: null },
    { label: "ABC product analysis", value: formatMoney(0), note: "C" },
  ];

  return (
    <Card size="sm" className="mb-4">
      <CardContent>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-0">
          <div className="flex items-center lg:pr-4">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Calendar className="size-3.5" />
              30 days
            </span>
          </div>
          {tiles.map((t, i) => (
            <div
              key={t.label}
              className={
                "flex-1 lg:px-6 lg:first:border-0 " +
                (i > 0 ? "lg:border-l" : "")
              }
            >
              <p className="text-sm text-muted-foreground underline decoration-muted-foreground/30 decoration-dotted underline-offset-4">
                {t.label}
              </p>
              <p className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-lg font-semibold tabular-nums">{t.value}</span>
                {t.note && <span className="text-sm text-muted-foreground">{t.note}</span>}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
