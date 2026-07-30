import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Customer, Order, OrderItem } from "@/lib/types";

/**
 * Storefront account helpers.
 *
 * The shopper's identity has two halves that can disagree, and the whole file
 * exists to keep that distinction honest:
 *
 *   * the `auth.users` session — proves who signed in
 *   * the `customers` row      — the shop identity that owns orders
 *
 * A signed-in shopper whose email is unconfirmed has the first and not the
 * second, because `link_customer_account()` refuses to hand over order history
 * to an unproven address. So `customer` is legitimately null for a real,
 * authenticated user, and every caller has to handle it.
 */

export interface AccountSession {
  userId: string;
  email: string | null;
  emailConfirmed: boolean;
  isStaff: boolean;
  /** Null until the email is confirmed — see link_customer_account(). */
  customer: Customer | null;
}

export async function getAccountSession(): Promise<AccountSession | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: isStaff } = await supabase.rpc("is_staff");

    // Idempotent: creates or claims the record on first confirmed visit, and
    // is a single indexed lookup on every visit after that.
    const { data: customerId } = await supabase.rpc("link_customer_account");

    let customer: Customer | null = null;
    if (customerId) {
      const { data } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .maybeSingle();
      customer = (data as Customer) ?? null;
    }

    return {
      userId: user.id,
      email: user.email ?? null,
      emailConfirmed: Boolean(user.email_confirmed_at),
      isStaff: Boolean(isStaff),
      customer,
    };
  } catch {
    // Supabase unreachable — treat as signed out rather than erroring the page.
    return null;
  }
}

/** Guards the account area. Redirects to sign-in, preserving where they meant to go. */
export async function requireAccount(returnTo = "/account"): Promise<AccountSession> {
  const session = await getAccountSession();
  if (!session) {
    redirect(`/account/login?next=${encodeURIComponent(returnTo)}`);
  }
  return session;
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */

export interface AccountOrder extends Order {
  items: OrderItem[];
  /** First product image per line, resolved for the order thumbnails. */
  thumbnails: string[];
}

/**
 * "Open" is what the shopper is still waiting on — anything not yet fully
 * fulfilled, and not refunded. Everything else is history. Deliberately derived
 * from fulfilment rather than age: a three-month-old unfulfilled order is still
 * an open problem, and burying it under "past" is how support tickets start.
 *
 * A voided or restocked order is never coming — it is history no matter how
 * un-fulfilled it looks, so it must not sit in "open" waiting forever.
 */
export function isOpenOrder(order: Order): boolean {
  if (order.payment_status === "refunded") return false;
  if (order.payment_status === "voided") return false;
  if (order.fulfillment_status === "restocked") return false;
  return order.fulfillment_status !== "fulfilled";
}

export async function getAccountOrders(
  customerId: string
): Promise<AccountOrder[]> {
  const supabase = await createClient();

  // RLS scopes this to the caller's own orders; the explicit customer_id filter
  // is belt-and-braces, not the security boundary.
  const { data } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("customer_id", customerId)
    .eq("is_draft", false)
    .order("created_at", { ascending: false });

  const orders = (data ?? []) as (Order & { order_items: OrderItem[] })[];
  if (!orders.length) return [];

  // Resolve one image per distinct product across all orders in a single query
  // rather than per line item.
  const productIds = [
    ...new Set(
      orders.flatMap((o) =>
        (o.order_items ?? []).map((i) => i.product_id).filter(Boolean)
      )
    ),
  ] as string[];

  const imageByProduct = new Map<string, string>();
  if (productIds.length) {
    const { data: images } = await supabase
      .from("product_images")
      .select("product_id, url, position")
      .in("product_id", productIds)
      .order("position");
    for (const img of (images ?? []) as {
      product_id: string;
      url: string;
    }[]) {
      if (!imageByProduct.has(img.product_id)) {
        imageByProduct.set(img.product_id, img.url);
      }
    }
  }

  return orders.map((o) => {
    const items = o.order_items ?? [];
    return {
      ...o,
      items,
      thumbnails: items
        .map((i) => (i.product_id ? imageByProduct.get(i.product_id) : null))
        .filter((url): url is string => Boolean(url)),
    };
  });
}

export async function getAccountOrder(
  customerId: string,
  orderId: string
): Promise<AccountOrder | null> {
  const orders = await getAccountOrders(customerId);
  return orders.find((o) => o.id === orderId) ?? null;
}
