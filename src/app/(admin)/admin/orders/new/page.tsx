import { getShopCurrency } from "@/lib/admin/reference";
import { OrderBuilder } from "./order-builder";

export const metadata = { title: "Create order" };

/**
 * The builder used to be handed the entire catalogue and customer list as props
 * so two `<select>` elements could be filled — 3.7 MB of JSON for a page whose
 * operator picks a handful of lines. Both are searched on demand now, so this
 * page ships only the currency the money is rendered in.
 */
export default async function NewOrderPage() {
  return <OrderBuilder currency={await getShopCurrency()} />;
}
