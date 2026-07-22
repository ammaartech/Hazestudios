import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { PaymentBadge, FulfillmentBadge } from "@/components/admin/status-badges";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import type { Customer, Order } from "@/lib/types";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: customer }, { data: ordersData }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).single(),
    supabase
      .from("orders")
      .select("*")
      .eq("customer_id", id)
      .eq("is_draft", false)
      .order("created_at", { ascending: false }),
  ]);

  if (!customer) notFound();
  const c = customer as Customer;
  const orders = (ordersData ?? []) as Order[];

  const name = `${c.first_name} ${c.last_name}`.trim() || c.email || "Customer";

  return (
    <div>
      <PageHeader title={name} backHref="/admin/customers" backLabel="Customers" />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">Amount spent</p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {formatMoney(c.total_spent)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">Orders</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{c.orders_count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">Customer since</p>
            <p className="mt-1 text-xl font-bold">{formatDate(c.created_at)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-base">Order history</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              This customer hasn&apos;t placed any orders yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Fulfillment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link
                        href={`/orders/${o.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        #{o.order_number}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(o.created_at)}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(o.total, o.currency)}
                    </TableCell>
                    <TableCell>
                      <PaymentBadge status={o.payment_status} />
                    </TableCell>
                    <TableCell>
                      <FulfillmentBadge status={o.fulfillment_status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CustomerForm
        initial={{
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email ?? "",
          phone: c.phone ?? "",
          notes: c.notes,
          tags: c.tags,
          accepts_marketing: c.accepts_marketing,
          default_address: c.default_address ?? {},
        }}
      />
    </div>
  );
}
