import { createClient } from "@/lib/supabase/server";
import { OrderBuilder } from "./order-builder";

export const metadata = { title: "Create order" };
export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const supabase = await createClient();
  const [{ data: products }, { data: customers }] = await Promise.all([
    supabase
      .from("products")
      .select("*, product_variants(*)")
      .neq("status", "archived")
      .order("title"),
    supabase.from("customers").select("*").order("first_name"),
  ]);

  return (
    <OrderBuilder products={products ?? []} customers={customers ?? []} />
  );
}
