"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProductsByIds } from "@/lib/shop/queries";
import {
  EMPTY_CART,
  MAX_LINE_QUANTITY,
  getCart,
  getCartRow,
  readCartToken,
  writeCartCookie,
  type Cart,
} from "@/lib/shop/cart";

/**
 * Cart mutations.
 *
 * A Server Action is a public POST endpoint — the fact that the only UI calling
 * it is a product page is not a security boundary. So every action here:
 *
 *   1. validates its input shape (the ids below are all uuids or nothing),
 *   2. resolves the caller's cart from the httpOnly cookie, never from an id in
 *      the request — the browser says *what* to change, never *whose*,
 *   3. scopes every write by that cart_id, so a guessed line id hits nothing,
 *   4. re-checks purchasability server-side, because a disabled button is a
 *      hint to the shopper and not a constraint on the request.
 *
 * Each returns the freshly resolved cart so the client can replace its state
 * with server truth rather than guessing at the outcome.
 */

export type CartResult =
  | { ok: true; cart: Cart }
  | { ok: false; error: string; cart: Cart };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

/**
 * Rejecting a malformed id here rather than passing it to PostgREST keeps the
 * failure a readable message instead of a database type error.
 */
function readQuantity(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > MAX_LINE_QUANTITY) return null;
  return n;
}

async function fail(error: string): Promise<CartResult> {
  return { ok: false, error, cart: await getCart() };
}

/* -------------------------------------------------------------------------- */

/**
 * Adds a variant (or a simple product) to the cart, creating the cart on first
 * use. Adding something already present increases its quantity rather than
 * opening a second line.
 */
export async function addToCart(input: {
  productId: string;
  variantId?: string | null;
  quantity?: number;
}): Promise<CartResult> {
  const { productId } = input;
  const variantId = input.variantId ?? null;
  const quantity = readQuantity(input.quantity, 1);

  if (!isUuid(productId)) return fail("That item could not be added.");
  if (variantId !== null && !isUuid(variantId)) {
    return fail("That option could not be added.");
  }
  if (quantity === null) return fail("That quantity is not available.");

  const admin = createAdminClient();
  if (!admin) return fail("The store is not available right now.");

  // ---- Is this actually for sale? ----------------------------------------
  // Resolved through the same storefront query the cart itself uses, rather
  // than a bespoke status check here. That matters: "purchasable" is a real
  // rule (product status, the operator's per-variant switch, inventory, and
  // two independent overselling flags), and a second implementation of it
  // would eventually disagree with the first. This one also runs on the anon
  // RLS path, so a draft product is simply not found.
  const [product] = await getProductsByIds([productId]);
  if (!product) return fail("That item is no longer available.");

  // A variant id from the client is not trusted to belong to the product it
  // was sent with — that pairing is verified against the database.
  const variant = variantId
    ? (product.variants.find((v) => v.id === variantId) ?? null)
    : null;

  if (variantId && !variant) return fail("That option is no longer available.");
  if (variant && !variant.available) return fail("That option is sold out.");
  if (!variant && !product.inStock) return fail("That item is sold out.");

  // ---- Write ---------------------------------------------------------------
  const token = await readCartToken();
  const cart = await getCartRow(token, true);
  if (!cart) return fail("Your bag could not be opened. Try again.");

  // New cart, or the old cookie pointed at a swept one.
  if (cart.token !== token) await writeCartCookie(cart.token);

  const match = admin
    .from("cart_items")
    .select("id, quantity")
    .eq("cart_id", cart.id)
    .eq("product_id", productId);

  const { data: existing } = await (variantId
    ? match.eq("variant_id", variantId)
    : match.is("variant_id", null)
  ).maybeSingle();

  if (existing) {
    const next = Math.min(
      (existing as { quantity: number }).quantity + quantity,
      MAX_LINE_QUANTITY
    );
    await admin
      .from("cart_items")
      .update({ quantity: next })
      .eq("id", (existing as { id: string }).id)
      .eq("cart_id", cart.id);
  } else {
    const { error } = await admin.from("cart_items").insert({
      cart_id: cart.id,
      product_id: productId,
      variant_id: variantId,
      quantity,
    });

    // 23505 = the partial unique index fired, meaning a concurrent add beat us
    // to it. The line exists now, so fold this quantity into it instead.
    if (error?.code === "23505") {
      const retry = admin
        .from("cart_items")
        .select("id, quantity")
        .eq("cart_id", cart.id)
        .eq("product_id", productId);

      const { data: row } = await (variantId
        ? retry.eq("variant_id", variantId)
        : retry.is("variant_id", null)
      ).maybeSingle();

      if (row) {
        await admin
          .from("cart_items")
          .update({
            quantity: Math.min(
              (row as { quantity: number }).quantity + quantity,
              MAX_LINE_QUANTITY
            ),
          })
          .eq("id", (row as { id: string }).id);
      }
    } else if (error) {
      return fail("That item could not be added.");
    }
  }

  return { ok: true, cart: await getCart() };
}

/**
 * Sets a line's quantity outright. Zero removes it, which is what the stepper's
 * lower bound does — one fewer round trip than a separate remove call.
 */
export async function setLineQuantity(
  lineId: string,
  quantity: number
): Promise<CartResult> {
  if (!isUuid(lineId)) return fail("That item is not in your bag.");

  const clamped = Math.floor(Number(quantity));
  if (!Number.isFinite(clamped) || clamped < 0 || clamped > MAX_LINE_QUANTITY) {
    return fail("That quantity is not available.");
  }

  const admin = createAdminClient();
  if (!admin) return fail("The store is not available right now.");

  const cart = await getCartRow(await readCartToken());
  if (!cart) return { ok: true, cart: EMPTY_CART };

  // `.eq("cart_id")` is the ownership check: a line id belonging to somebody
  // else's cart matches zero rows and changes nothing.
  const query =
    clamped === 0
      ? admin.from("cart_items").delete()
      : admin.from("cart_items").update({ quantity: clamped });

  await query.eq("id", lineId).eq("cart_id", cart.id);

  return { ok: true, cart: await getCart() };
}

export async function removeLine(lineId: string): Promise<CartResult> {
  return setLineQuantity(lineId, 0);
}

export async function clearCart(): Promise<CartResult> {
  const admin = createAdminClient();
  if (!admin) return fail("The store is not available right now.");

  const cart = await getCartRow(await readCartToken());
  if (!cart) return { ok: true, cart: EMPTY_CART };

  await admin.from("cart_items").delete().eq("cart_id", cart.id);
  return { ok: true, cart: EMPTY_CART };
}

/**
 * Re-reads the cart without changing it. Used by the client provider to
 * resynchronise after a tab has been in the background, or after signing in.
 */
export async function refreshCart(): Promise<Cart> {
  return getCart();
}

/**
 * Attaches the current guest cart to the signed-in shopper, merging it with any
 * cart they already had. Safe to call on every sign-in: claim_cart() is
 * idempotent and returns the surviving token, which may not be the one we sent.
 *
 * Runs on the shopper's own session rather than the service role — the RPC
 * derives the customer from auth.uid(), so it cannot be pointed at anyone else.
 */
export async function claimCart(): Promise<void> {
  try {
    const token = await readCartToken();
    if (!token) return;

    const supabase = await createClient();
    const { data: survivor } = await supabase.rpc("claim_cart", {
      p_token: token,
    });

    if (typeof survivor === "string" && survivor !== token) {
      await writeCartCookie(survivor);
    }
  } catch {
    // A cart that fails to merge must never block signing in.
  }
}
