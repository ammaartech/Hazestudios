import { cookies } from "next/headers";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductsByIds, type ShopProduct, type ShopVariant } from "./queries";

/**
 * Cart data access.
 *
 * Two clients are in play here and the split is deliberate:
 *
 *   * cart rows        — service role, because `carts` grants nothing to anon
 *                        or authenticated (see 0011_carts.sql). The cookie
 *                        token is the credential, and RLS cannot read cookies.
 *   * product data     — the ordinary storefront client, so the public RLS
 *                        policies still decide what is visible. A line pointing
 *                        at a product that has been unpublished resolves to
 *                        nothing and is dropped, rather than leaking a draft.
 *
 * Nothing in this file trusts a price, title or quantity that came from the
 * browser. The browser supplies ids and a quantity; everything else is looked
 * up again on every read.
 */

export const CART_COOKIE = "haze_cart";

/** Matches the 60-day guest sweep in sweep_abandoned_carts(). */
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 60;

/** Per-line ceiling, mirroring the check constraint on cart_items.quantity. */
export const MAX_LINE_QUANTITY = 99;

export interface CartLine {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  /** Resolved live — never read from the cart row. */
  title: string;
  handle: string;
  variantTitle: string;
  price: number;
  compareAtPrice: number | null;
  image: string | null;
  lineTotal: number;
  /** False when the product or variant is no longer purchasable. */
  available: boolean;
  /** Stock ceiling, or null when this line is not inventory-limited. */
  maxQuantity: number | null;
  /** True when quantity had to be capped because stock fell below it. */
  reduced: boolean;
}

export interface Cart {
  lines: CartLine[];
  /** Total units, not lines — this is what the header badge shows. */
  count: number;
  subtotal: number;
  currency: string;
  /**
   * Lines that could not be resolved and were removed, described for the
   * shopper. A cart that silently shrinks is worse than one that explains.
   */
  removed: string[];
}

export const EMPTY_CART: Cart = {
  lines: [],
  count: 0,
  subtotal: 0,
  currency: "INR",
  removed: [],
};

/* -------------------------------------------------------------------------- */
/* Token                                                                       */
/* -------------------------------------------------------------------------- */

export async function readCartToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(CART_COOKIE)?.value ?? null;
}

/**
 * 32 random bytes, base64url. Long enough that guessing is not a strategy, and
 * URL-safe so it survives being logged or round-tripped without escaping.
 */
function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Writes the cart cookie. Only callable from a Server Action or Route Handler —
 * Server Components cannot set cookies.
 */
export async function writeCartCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE, token, {
    // The token is a bearer credential; JavaScript never needs to read it.
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE,
  });
}

export async function clearCartCookie(): Promise<void> {
  const store = await cookies();
  store.delete(CART_COOKIE);
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

interface CartItemRow {
  id: string;
  cart_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
}

/**
 * Resolves the cart row for a token, creating one if `create` is set.
 *
 * Returns null when there is no cart and none was asked for, which is the
 * ordinary state for a first-time visitor — not an error.
 */
export async function getCartRow(
  token: string | null,
  create = false
): Promise<{ id: string; token: string } | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  if (token) {
    const { data } = await admin
      .from("carts")
      .select("id, token")
      .eq("token", token)
      .maybeSingle();
    if (data) return data as { id: string; token: string };
  }

  if (!create) return null;

  // Either no cookie, or a cookie pointing at a cart that has been swept.
  const fresh = newToken();
  const { data, error } = await admin
    .from("carts")
    .insert({ token: fresh })
    .select("id, token")
    .single();

  if (error || !data) return null;
  return data as { id: string; token: string };
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How many of this line may be bought, or null when it isn't limited.
 *
 * Three independent ways a line escapes its stock count, matching how the admin
 * and the PDP already treat it: the product doesn't track inventory, the
 * product allows overselling, or the variant does.
 */
function stockCeiling(
  product: ShopProduct,
  variant: ShopVariant | null
): number | null {
  const productUnlimited = !product.track_inventory || product.continue_selling;

  if (variant) {
    const unlimited =
      productUnlimited || !variant.track_inventory || variant.continue_selling;
    return unlimited ? null : variant.stock;
  }

  return productUnlimited ? null : product.totalStock;
}

/**
 * Turns stored rows into displayable lines, against today's catalogue.
 *
 * Lines whose product or variant has gone away are dropped and reported. Lines
 * whose stock has fallen below the stored quantity are capped rather than
 * dropped — the shopper still wants the item, just fewer of them.
 */
function resolveLines(
  rows: CartItemRow[],
  products: ShopProduct[]
): { lines: CartLine[]; removed: string[]; stale: CartItemRow[] } {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: CartLine[] = [];
  const removed: string[] = [];
  const stale: CartItemRow[] = [];

  for (const row of rows) {
    const product = byId.get(row.product_id);
    if (!product) {
      // Unpublished, archived or deleted since it was added.
      stale.push(row);
      removed.push("An item is no longer available and was removed.");
      continue;
    }

    const variant = row.variant_id
      ? (product.variants.find((v) => v.id === row.variant_id) ?? null)
      : null;

    // The row names a variant the product no longer has.
    if (row.variant_id && !variant) {
      stale.push(row);
      removed.push(`${product.title} is no longer available in that option.`);
      continue;
    }

    const ceiling = stockCeiling(product, variant);
    const sellable = variant ? variant.available : product.inStock;

    // Out of stock entirely — kept in the cart, shown as unavailable, and
    // excluded from the total. Removing it outright would lose the shopper's
    // intent to buy it if it comes back.
    const quantity =
      ceiling === null ? row.quantity : Math.min(row.quantity, Math.max(ceiling, 0));

    const price = variant ? variant.price : product.price;
    const compareAt = variant
      ? (variant.compare_at_price ?? product.compare_at_price)
      : product.compare_at_price;

    const image =
      (variant?.image_id
        ? product.images.find((i) => i.id === variant.image_id)?.url
        : undefined) ??
      product.images[0]?.url ??
      null;

    const available = sellable && (ceiling === null || ceiling > 0);

    lines.push({
      id: row.id,
      productId: product.id,
      variantId: variant?.id ?? null,
      quantity: Math.max(quantity, 1),
      title: product.title,
      handle: product.handle || product.id,
      variantTitle: variant?.title ?? "",
      price,
      compareAtPrice: compareAt != null && compareAt > price ? compareAt : null,
      image,
      lineTotal: available ? price * Math.max(quantity, 1) : 0,
      available,
      maxQuantity: ceiling,
      reduced: available && quantity < row.quantity,
    });
  }

  return { lines, removed, stale };
}

/**
 * The cart as the shopper should see it right now.
 *
 * Defensive throughout: an unconfigured or unreachable Supabase yields an empty
 * cart rather than an error page. A storefront that cannot reach its database
 * should still render.
 */
export async function getCart(): Promise<Cart> {
  try {
    const token = await readCartToken();
    if (!token) return EMPTY_CART;

    const admin = createAdminClient();
    if (!admin) return EMPTY_CART;

    const cart = await getCartRow(token);
    if (!cart) return EMPTY_CART;

    const { data } = await admin
      .from("cart_items")
      .select("id, cart_id, product_id, variant_id, quantity")
      .eq("cart_id", cart.id)
      .order("created_at");

    const rows = (data ?? []) as CartItemRow[];
    if (!rows.length) return EMPTY_CART;

    const products = await getProductsByIds([
      ...new Set(rows.map((r) => r.product_id)),
    ]);

    const { lines, removed, stale } = resolveLines(rows, products);

    // Clean up rows that can never resolve again. Deferred with `after` rather
    // than left as a floating promise: the cart the shopper sees is already
    // correct without it, so this must not delay the response — but a bare
    // `void promise` would be cut off when the invocation ends. The ids are
    // captured here, outside the callback, because a Server Component may not
    // touch request APIs inside one.
    if (stale.length) {
      const staleIds = stale.map((r) => r.id);
      after(async () => {
        await admin.from("cart_items").delete().in("id", staleIds);
      });
    }

    return {
      lines,
      count: lines.reduce((n, l) => n + (l.available ? l.quantity : 0), 0),
      subtotal: lines.reduce((n, l) => n + l.lineTotal, 0),
      currency: "INR",
      // One message per distinct reason, however many lines hit it.
      removed: [...new Set(removed)],
    };
  } catch {
    return EMPTY_CART;
  }
}
