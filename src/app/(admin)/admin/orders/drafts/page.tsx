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
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Customer, Order } from "@/lib/types";

export const metadata = { title: "Draft orders" };
export const dynamic = "force-dynamic";

type DraftRow = Order & {
  customers: Pick<Customer, "first_name" | "last_name" | "email"> | null;
};

export default async function DraftsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("*, customers(first_name, last_name, email)")
    .eq("is_draft", true)
    .order("created_at", { ascending: false });

  const drafts = (data ?? []) as DraftRow[];

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
                        href={`/orders/${o.id}`}
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
        </CardContent>
      </Card>
    </div>
  );
}
