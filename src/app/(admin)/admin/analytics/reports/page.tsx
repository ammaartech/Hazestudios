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
import { FilterTabs } from "@/components/admin/filter-tabs";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import type { Customer, Order, OrderItem } from "@/lib/types";
import { CsvExportButton, DateRangeFilter } from "./report-controls";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const REPORTS = [
  { value: undefined, key: "sales_by_day", label: "Sales by day" },
  { value: "by_product", key: "by_product", label: "Sales by product" },
  { value: "by_customer", key: "by_customer", label: "Sales by customer" },
  { value: "payment_status", key: "payment_status", label: "Payment status" },
  { value: "discounts", key: "discounts", label: "Discount usage" },
];

type OrderWithCustomer = Order & { customers: Customer | null };
type ItemWithOrder = OrderItem & { orders: Order };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; from?: string; to?: string }>;
}) {
  const { report, from, to } = await searchParams;
  const supabase = await createClient();

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (toDate) toDate.setHours(23, 59, 59, 999);

  let ordersQuery = supabase
    .from("orders")
    .select("*, customers(*)")
    .eq("is_draft", false)
    .order("created_at", { ascending: true });
  if (fromDate) ordersQuery = ordersQuery.gte("created_at", fromDate.toISOString());
  if (toDate) ordersQuery = ordersQuery.lte("created_at", toDate.toISOString());

  const [{ data: ordersData }, { data: itemsData }] = await Promise.all([
    ordersQuery,
    supabase
      .from("order_items")
      .select("*, orders!inner(*)")
      .eq("orders.is_draft", false),
  ]);

  const orders = (ordersData ?? []) as OrderWithCustomer[];
  const paid = (o: Order) =>
    o.payment_status === "paid" || o.payment_status === "partially_refunded";
  const items = ((itemsData ?? []) as ItemWithOrder[]).filter((i) => {
    const created = new Date(i.orders.created_at);
    if (fromDate && created < fromDate) return false;
    if (toDate && created > toDate) return false;
    return paid(i.orders);
  });

  let headers: string[] = [];
  let rows: (string | number)[][] = [];

  switch (report) {
    case "by_product": {
      headers = ["Product", "Units sold", "Revenue"];
      const map = new Map<string, { units: number; revenue: number }>();
      for (const i of items) {
        const cur = map.get(i.title_snapshot) ?? { units: 0, revenue: 0 };
        cur.units += i.quantity;
        cur.revenue += Number(i.price_snapshot) * i.quantity;
        map.set(i.title_snapshot, cur);
      }
      rows = [...map.entries()]
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([name, v]) => [name, v.units, formatMoney(v.revenue)]);
      break;
    }
    case "by_customer": {
      headers = ["Customer", "Orders", "Total spent"];
      const map = new Map<string, { orders: number; total: number }>();
      for (const o of orders.filter(paid)) {
        const name = o.customers
          ? `${o.customers.first_name} ${o.customers.last_name}`.trim() ||
            o.customers.email ||
            "Unknown"
          : "No customer";
        const cur = map.get(name) ?? { orders: 0, total: 0 };
        cur.orders += 1;
        cur.total += Number(o.total);
        map.set(name, cur);
      }
      rows = [...map.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([name, v]) => [name, v.orders, formatMoney(v.total)]);
      break;
    }
    case "payment_status": {
      headers = ["Payment status", "Orders", "Total value"];
      const map = new Map<string, { orders: number; total: number }>();
      for (const o of orders) {
        const key = o.payment_status.replace(/_/g, " ");
        const cur = map.get(key) ?? { orders: 0, total: 0 };
        cur.orders += 1;
        cur.total += Number(o.total);
        map.set(key, cur);
      }
      rows = [...map.entries()].map(([k, v]) => [k, v.orders, formatMoney(v.total)]);
      break;
    }
    case "discounts": {
      headers = ["Discount code", "Orders", "Total discounted"];
      const map = new Map<string, { orders: number; total: number }>();
      for (const o of orders) {
        if (!o.discount_code) continue;
        const cur = map.get(o.discount_code) ?? { orders: 0, total: 0 };
        cur.orders += 1;
        cur.total += Number(o.discount_total);
        map.set(o.discount_code, cur);
      }
      rows = [...map.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([k, v]) => [k, v.orders, formatMoney(v.total)]);
      break;
    }
    default: {
      headers = ["Date", "Orders", "Paid orders", "Gross sales"];
      const map = new Map<string, { orders: number; paidCount: number; sales: number }>();
      for (const o of orders) {
        const key = formatDate(o.created_at);
        const cur = map.get(key) ?? { orders: 0, paidCount: 0, sales: 0 };
        cur.orders += 1;
        if (paid(o)) {
          cur.paidCount += 1;
          cur.sales += Number(o.total);
        }
        map.set(key, cur);
      }
      rows = [...map.entries()].map(([k, v]) => [
        k,
        v.orders,
        v.paidCount,
        formatMoney(v.sales),
      ]);
    }
  }

  const activeReport =
    REPORTS.find((r) => r.value === report) ?? REPORTS[0];

  return (
    <div>
      <PageHeader title="Reports" backHref="/admin/analytics" backLabel="Analytics">
        <CsvExportButton
          headers={headers}
          rows={rows}
          filename={`${activeReport.key}.csv`}
        />
      </PageHeader>

      <Card>
        <CardContent className="pt-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <FilterTabs
              basePath="/admin/analytics/reports"
              param="report"
              current={report}
              tabs={REPORTS.map((r) => ({ label: r.label, value: r.value }))}
            />
            <DateRangeFilter />
          </div>

          {rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No data for this report in the selected date range.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    {row.map((cell, j) => (
                      <TableCell
                        key={j}
                        className={j === 0 ? "font-medium" : "tabular-nums"}
                      >
                        {cell}
                      </TableCell>
                    ))}
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
