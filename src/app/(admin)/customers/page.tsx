import Link from "next/link";
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
import { SearchInput } from "@/components/admin/search-input";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import type { Customer } from "@/lib/types";

export const metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });
  if (q) {
    query = query.or(
      `first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`
    );
  }
  const { data } = await query;
  const customers = (data ?? []) as Customer[];

  return (
    <div>
      <PageHeader title="Customers">
        <Button asChild>
          <Link href="/customers/new">Add customer</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-0">
          <div className="mb-3 flex justify-end">
            <SearchInput placeholder="Search customers" />
          </div>
          {customers.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No customers yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Amount spent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/customers/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {`${c.first_name} ${c.last_name}`.trim() || c.email || "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.email ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {[c.default_address?.city, c.default_address?.country]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">{c.orders_count}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(c.total_spent)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
