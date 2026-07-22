import Link from "next/link";
import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { ProductStatusBadge } from "@/components/admin/status-badges";
import { FilterTabs } from "@/components/admin/filter-tabs";
import { SearchInput } from "@/components/admin/search-input";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import type { Product, ProductImage } from "@/lib/types";

export const metadata = { title: "Products" };
export const dynamic = "force-dynamic";

type ProductRow = Product & {
  product_images: Pick<ProductImage, "url" | "position">[];
  inventory_levels: { quantity: number }[];
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("products")
    .select("*, product_images(url, position), inventory_levels(quantity)")
    .order("created_at", { ascending: false });

  if (status && ["active", "draft", "archived"].includes(status)) {
    query = query.eq("status", status);
  }
  if (q) {
    query = query.ilike("title", `%${q}%`);
  }

  const { data } = await query;
  const products = (data ?? []) as ProductRow[];

  return (
    <div>
      <PageHeader title="Products">
        <Button asChild>
          <Link href="/admin/products/new">Add product</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <FilterTabs
              basePath="/admin/products"
              param="status"
              current={status}
              tabs={[
                { label: "All", value: undefined },
                { label: "Active", value: "active" },
                { label: "Draft", value: "draft" },
                { label: "Archived", value: "archived" },
              ]}
            />
            <SearchInput placeholder="Search products" />
          </div>

          {products.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No products found.{" "}
              <Link href="/admin/products/new" className="text-primary hover:underline">
                Add your first product
              </Link>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" />
                  <TableHead>Product</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Inventory</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Vendor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => {
                  const cover = [...p.product_images].sort(
                    (a, b) => a.position - b.position
                  )[0];
                  const stock = p.inventory_levels.reduce(
                    (sum, l) => sum + l.quantity,
                    0
                  );
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <span className="flex size-10 items-center justify-center overflow-hidden rounded-md border bg-muted">
                          {cover ? (
                            <Image
                              src={cover.url}
                              alt={p.title}
                              width={40}
                              height={40}
                              className="size-10 object-cover"
                              unoptimized
                            />
                          ) : (
                            <ImageIcon className="size-4 text-muted-foreground" />
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/products/${p.id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {p.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <ProductStatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {p.track_inventory ? (
                          <span className={stock <= 0 ? "text-destructive" : ""}>
                            {stock} in stock
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Not tracked</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatMoney(p.price)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.product_type || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.vendor || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
