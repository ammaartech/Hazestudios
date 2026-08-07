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
import { Pagination } from "@/components/admin/pagination";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Customer, Order } from "@/lib/types";

export const metadata = { title: "Draft orders" };

const PAGE_SIZE = 50;

type DraftRow = Pick<
  Order,
  "id" | "order_number" | "created_at" | "total" | "currency"
> & {
  customers: Pick<Customer, "first_name" | "last_name" | "email"> | null;
};

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const supabase = await createClient();

  const page = Math.max(0, parseInt(pageParam ?? "0", 10) || 0);

  const { data, count } = await supabase
    .from("orders")
    .select(
      "id, order_number, created_at, total, currency, customers(first_name, last_name, email)",
      { count: "exact" }
    )
    .eq("is_draft", true)
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  // Via unknown: without generated DB types the client guesses the to-one
  // `customers` join is an array; at runtime PostgREST returns object-or-null.
  const drafts = (data ?? []) as unknown as DraftRow[];
  const total = count ?? 0;

  return (
    <div>
      <PageHeader title="Drafts" backHref="/admin/orders" backLabel="Orders">
        <Button asChild>
          <Link href="/admin/orders/new">Create order</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-0">
          {drafts.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Draft orders let you build custom orders and send invoices later.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Draft</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="font-semibold hover:underline"
                      >
                        #D{o.order_number}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDateTime(o.created_at)}</TableCell>
                    <TableCell>
                      {o.customers
                        ? `${o.customers.first_name} ${o.customers.last_name}`.trim() ||
                          o.customers.email
                        : "No customer"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(o.total, o.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
