import { createClient } from "@/lib/supabase/server";
import { OrderList, type OrderRow } from "./order-list";

export const metadata = { title: "Orders" };
const PAGE_SIZE = 50;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  const { tab, q, page: pageParam } = await searchParams;
  const supabase = await createClient();

  const page = Math.max(0, parseInt(pageParam ?? "0", 10) || 0);

  // Bounded like customers: `range` keeps the payload at one page and `count`
  // keeps the pager honest past PostgREST's 1,000-row response ceiling.
  let query = supabase
    .from("orders")
    .select(
      "id, order_number, created_at, total, currency, payment_status, fulfillment_status, cancelled_at, held_at, released_at, customers(first_name, last_name, email), order_items(quantity), fulfillments(tracking_number, status)",
      { count: "exact" }
    )
    .eq("is_draft", false)
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (tab === "unfulfilled") query = query.eq("fulfillment_status", "unfulfilled");
  // Partially paid is still owed money — a COD order whose advance is in.
  if (tab === "unpaid") query = query.in("payment_status", ["pending", "partially_paid"]);
  // Parked by the COD rule (0033) and not yet approved or paid an advance.
  if (tab === "review") query = query.not("held_at", "is", null).is("released_at", null).is("cancelled_at", null);
  if (tab === "open") query = query.is("closed_at", null);
  if (tab === "closed") query = query.not("closed_at", "is", null);
  if (q && /^\d+$/.test(q)) query = query.eq("order_number", parseInt(q));

  const { data, count } = await query;
  // Via unknown: without generated DB types the client guesses the to-one
  // `customers` join is an array; at runtime PostgREST returns object-or-null.
  const orders = (data ?? []) as unknown as OrderRow[];
  const total = count ?? 0;

  return <OrderList key={`${tab ?? ""}:${q ?? ""}:${page}`} orders={orders} total={total} page={page} pageSize={PAGE_SIZE} tab={tab} />;
}
