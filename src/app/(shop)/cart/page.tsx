import { CartView } from "@/components/shop/cart-view";

export const metadata = { title: "Bag" };

/**
 * The cart is per-shopper and cookie-scoped, so there is nothing here to cache
 * or prerender. The layout resolves it server-side into the cart context; this
 * page just gives it a full-size home.
 */
export default function CartPage() {
  return <CartView />;
}
