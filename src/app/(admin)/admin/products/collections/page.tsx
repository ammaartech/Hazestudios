import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/page-header";
import { createClient } from "@/lib/supabase/server";
import { productMatchesRules } from "@/lib/smart-collections";
import type { Collection, CollectionRule, Product } from "@/lib/types";
import { CollectionsTable, type CollectionListRow } from "./collections-table";

export const metadata = { title: "Collections" };
export const dynamic = "force-dynamic";

const OPERATOR_LABELS: Record<CollectionRule["operator"], string> = {
  equals: "is",
  contains: "contains",
  starts_with: "starts with",
  greater_than: ">",
  less_than: "<",
};

const FIELD_LABELS: Record<CollectionRule["field"], string> = {
  tag: "Tag",
  title: "Title",
  vendor: "Vendor",
  product_type: "Type",
  price: "Price",
};

/** "Tag is drop-01 · Price > 100" — the rule set, readable at a glance. */
function describeRules(rules: CollectionRule[]): string {
  return rules
    .filter((r) => r.value.trim())
    .map((r) => `${FIELD_LABELS[r.field]} ${OPERATOR_LABELS[r.operator]} ${r.value}`)
    .join(" · ");
}

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const { view, q } = await searchParams;
  const supabase = await createClient();

  let query = supabase.from("collections").select("*").order("title");
  if (view === "published") query = query.not("published_at", "is", null);
  if (view === "unpublished") query = query.is("published_at", null);
  if (q) query = query.ilike("title", `%${q}%`);

  const [{ data: collectionsData }, { data: countsData }, { data: productsData }] =
    await Promise.all([
      query,
      supabase.from("product_collections").select("collection_id"),
      // Smart collections are counted by evaluating their rules, which needs the
      // whole product row — the same evaluation the storefront runs.
      supabase.from("products").select("*"),
    ]);

  const collections = (collectionsData ?? []) as Collection[];
  const products = (productsData ?? []) as Product[];

  const manualCounts = new Map<string, number>();
  for (const row of countsData ?? []) {
    manualCounts.set(
      row.collection_id,
      (manualCounts.get(row.collection_id) ?? 0) + 1
    );
  }

  const rows: CollectionListRow[] = collections.map((c) => ({
    id: c.id,
    title: c.title,
    handle: c.handle,
    type: c.type,
    image_url: c.image_url,
    productCount:
      c.type === "manual"
        ? (manualCounts.get(c.id) ?? 0)
        : products.filter((p) => productMatchesRules(p, c.rules)).length,
    conditions: c.type === "smart" ? describeRules(c.rules) : "",
    published: Boolean(c.published_at),
    updated_at: c.updated_at,
  }));

  return (
    <div>
      <PageHeader title="Collections">
        <Button asChild>
          <Link href="/admin/products/collections/new">Add collection</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent>
          <CollectionsTable collections={rows} view={view} />
        </CardContent>
      </Card>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Collections group products for the storefront navigation, and each one
        gets its own page.
      </p>
    </div>
  );
}
