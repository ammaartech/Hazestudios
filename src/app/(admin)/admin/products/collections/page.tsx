import Link from "next/link";
import { Badge } from "@/components/ui/badge";
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
import { createClient } from "@/lib/supabase/server";
import { productMatchesRules } from "@/lib/smart-collections";
import type { Collection, Product } from "@/lib/types";

export const metadata = { title: "Collections" };
export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const supabase = await createClient();
  const [{ data: collectionsData }, { data: countsData }, { data: productsData }] =
    await Promise.all([
      supabase.from("collections").select("*").order("title"),
      supabase.from("product_collections").select("collection_id"),
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

  return (
    <div>
      <PageHeader title="Collections">
        <Button asChild>
          <Link href="/admin/products/collections/new">Create collection</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-0">
          {collections.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Group products into collections, manually or with smart rules.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Conditions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collections.map((c) => {
                  const count =
                    c.type === "manual"
                      ? manualCounts.get(c.id) ?? 0
                      : products.filter((p) => productMatchesRules(p, c.rules))
                          .length;
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link
                          href={`/products/collections/${c.id}`}
                          className="font-medium hover:underline"
                        >
                          {c.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.type === "smart" ? "default" : "secondary"}>
                          {c.type === "smart" ? "Smart" : "Manual"}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">{count}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.type === "smart" && c.rules.length
                          ? c.rules
                              .map((r) => `${r.field} ${r.operator.replace(/_/g, " ")} ${r.value}`)
                              .join(" · ")
                          : "—"}
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
