import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_CHECKOUT_SETTINGS,
  type CheckoutAddress,
  type CheckoutPrefill,
  type CheckoutSettings,
} from "./checkout-totals";
import type { Order, OrderItem } from "@/lib/types";

/**
 * Server-side checkout data access.
 *
 * Reaches the request through the Supabase server client, so nothing here is
 * importable from a Client Component — the arithmetic and the shared shapes
 * live in `./checkout-totals` for exactly that reason.
 */

export type { CheckoutAddress, CheckoutPrefill, CheckoutSettings };

/**
 * Reads the interim shipping/tax configuration.
 *
 * Runs on the ordinary storefront client: `shop_settings` is already readable
 * by anon under 0003, and nothing here is sensitive.
 */
export async function getCheckoutSettings(): Promise<CheckoutSettings> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("shop_settings")
      .select("checkout, currency")
      .eq("id", 1)
      .maybeSingle();

    if (!data) return DEFAULT_CHECKOUT_SETTINGS;

    const checkout = (data.checkout ?? {}) as Record<string, unknown>;
    const number = (value: unknown, fallback: number) =>
      Number.isFinite(Number(value)) ? Number(value) : fallback;

    return {
      flatRate: number(checkout.flat_rate, 0),
      freeThreshold:
        checkout.free_threshold == null
          ? null
          : number(checkout.free_threshold, 0),
      taxRate: number(checkout.tax_rate, 0),
      currency: (data.currency as string) ?? "USD",
    };
  } catch {
    return DEFAULT_CHECKOUT_SETTINGS;
  }
}

/* -------------------------------------------------------------------------- */
/* Prefill                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything we already know about the shopper, so a returning customer is not
 * asked to retype an address the store is holding.
 *
 * Falls back to an empty prefill rather than throwing: an unrecognised shopper
 * is the ordinary case at checkout, not an error.
 */
export async function getCheckoutPrefill(): Promise<CheckoutPrefill> {
  const empty: CheckoutPrefill = {
    email: "",
    phone: "",
    firstName: "",
    lastName: "",
    address: {},
    signedIn: false,
  };

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return empty;

    const { data: customerId } = await supabase.rpc("link_customer_account");
    if (!customerId) {
      // Signed in but unconfirmed — see src/lib/shop/account.ts. We know the
      // address they sign in with and nothing else yet.
      return { ...empty, email: user.email ?? "", signedIn: true };
    }

    const { data } = await supabase
      .from("customers")
      .select("first_name, last_name, email, phone, default_address")
      .eq("id", customerId)
      .maybeSingle();

    if (!data) return { ...empty, email: user.email ?? "", signedIn: true };

    return {
      email: (data.email as string) ?? user.email ?? "",
      phone: (data.phone as string) ?? "",
      firstName: (data.first_name as string) ?? "",
      lastName: (data.last_name as string) ?? "",
      address: (data.default_address ?? {}) as Partial<CheckoutAddress>,
      signedIn: true,
    };
  } catch {
    return empty;
  }
}

/* -------------------------------------------------------------------------- */
/* Placed orders                                                               */
/* -------------------------------------------------------------------------- */

export interface PlacedOrder extends Order {
  items: OrderItem[];
  /** One image per line, resolved for the confirmation thumbnails. */
  images: (string | null)[];
}

/**
 * Reads a placed order by its checkout token.
 *
 * Service role, deliberately — see the header of 0014_checkout.sql. The token
 * is a 256-bit bearer credential in the URL, which RLS cannot inspect, so the
 * check happens here: an exact match on a column that is unique and unguessable
 * is the authorisation. This is the same shape 0011 used for cart tokens.
 */
export async function getOrderByToken(
  token: string
): Promise<PlacedOrder | null> {
  // A token that could not have been issued is rejected before it reaches the
  // database, so a malformed URL is a 404 rather than a query.
  if (!/^[0-9a-f]{64}$/.test(token)) return null;

  const admin = createAdminClient();
  if (!admin) return null;

  const { data } = await admin
    .from("orders")
    .select("*, order_items(*)")
    .eq("checkout_token", token)
    .maybeSingle();

  if (!data) return null;

  const order = data as Order & { order_items: OrderItem[] };
  const items = order.order_items ?? [];

  const productIds = [
    ...new Set(items.map((i) => i.product_id).filter(Boolean)),
  ] as string[];

  const imageByProduct = new Map<string, string>();
  if (productIds.length) {
    const { data: images } = await admin
      .from("product_images")
      .select("product_id, url, position")
      .in("product_id", productIds)
      .order("position");

    for (const image of (images ?? []) as {
      product_id: string;
      url: string;
    }[]) {
      if (!imageByProduct.has(image.product_id)) {
        imageByProduct.set(image.product_id, image.url);
      }
    }
  }

  return {
    ...order,
    items,
    images: items.map((i) =>
      i.product_id ? (imageByProduct.get(i.product_id) ?? null) : null
    ),
  };
}
