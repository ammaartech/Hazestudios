"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clearCartCookie, readCartToken } from "@/lib/shop/cart";
import { formatMoney } from "@/lib/format";
import type { Discount } from "@/lib/types";

/**
 * Checkout mutations.
 *
 * `placeOrder` is a thin shell around `place_order()` in 0014_checkout.sql, and
 * that is the point: the seven writes that make up an order have to share one
 * transaction, so none of them happen here. What this file owns is the parts a
 * Postgres function cannot reach — the cart cookie, the request's own
 * attribution, and turning a raised exception into a sentence.
 *
 * Everything a Server Action receives is untrusted, including from our own
 * form. The cart is resolved from the httpOnly cookie rather than any field in
 * the submission, so a forged POST can only ever check out its own bag.
 */

/**
 * Interfaces are erased at compile time, so they are the only non-function
 * exports a `"use server"` module may carry — every runtime export here has to
 * be an async function, which is why the form owns its own initial state.
 */
export interface CheckoutState {
  error: string | null;
  /** Names the field to focus, when the failure belongs to one. */
  field: string | null;
}

/** SQLSTATE raised by place_order() for failures written to be shown as-is. */
const SHOPPER_VISIBLE = "HZ001";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function text(form: FormData, name: string, limit = 255): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/**
 * Campaign parameters, read off the landing URL the client captured.
 *
 * Only the five canonical keys are kept. Storing the whole query string would
 * mean storing session ids, `fbclid` and whatever else a redirect chain
 * appended, which is a privacy liability with no reporting value.
 */
function readUtm(raw: string): Record<string, string> {
  if (!raw) return {};
  try {
    const params = new URLSearchParams(
      raw.startsWith("?") ? raw : raw.slice(raw.indexOf("?"))
    );
    const utm: Record<string, string> = {};
    for (const key of ["source", "medium", "campaign", "term", "content"]) {
      const value = params.get(`utm_${key}`);
      if (value) utm[key] = value.slice(0, 128);
    }
    return utm;
  } catch {
    return {};
  }
}

export async function placeOrder(
  _previous: CheckoutState,
  form: FormData
): Promise<CheckoutState> {
  const email = text(form, "email").toLowerCase();
  if (!EMAIL.test(email)) {
    return { error: "Enter a valid email address.", field: "email" };
  }

  const address = {
    first_name: text(form, "first_name", 80),
    last_name: text(form, "last_name", 80),
    address1: text(form, "address1"),
    address2: text(form, "address2"),
    city: text(form, "city", 80),
    province: text(form, "province", 80),
    postal_code: text(form, "postal_code", 32),
    country: text(form, "country", 2),
  };

  // Checked here as well as in the function so the shopper gets the field back,
  // not just a sentence. The function keeps its own copy of these rules because
  // it is reachable without this action.
  const required: [keyof typeof address, string][] = [
    ["first_name", "Enter a first name."],
    ["last_name", "Enter a last name."],
    ["address1", "Enter a street address."],
    ["city", "Enter a city."],
    ["postal_code", "Enter a postal code."],
    ["country", "Choose a country."],
  ];
  for (const [field, message] of required) {
    if (!address[field]) return { error: message, field };
  }

  // Empty means "same as delivery" — see the column comment in 0014. An
  // unchecked box submits nothing at all, so presence is the test: absent means
  // the shopper cleared it and wants to type a separate billing address.
  const billingSame = form.get("billing_same") === "on";
  const billing = billingSame
    ? {}
    : {
        first_name: text(form, "billing_first_name", 80),
        last_name: text(form, "billing_last_name", 80),
        address1: text(form, "billing_address1"),
        address2: text(form, "billing_address2"),
        city: text(form, "billing_city", 80),
        province: text(form, "billing_province", 80),
        postal_code: text(form, "billing_postal_code", 32),
        country: text(form, "billing_country", 2),
      };

  if (!billingSame && (!billing.address1 || !billing.city || !billing.country)) {
    return { error: "Enter a complete billing address.", field: "billing_address1" };
  }

  const cartToken = await readCartToken();
  if (!cartToken) {
    return { error: "Your bag is empty.", field: null };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { error: "The store is not available right now.", field: null };
  }

  const landingPath = text(form, "landing_path", 512);

  const { data, error } = await admin.rpc("place_order", {
    payload: {
      cart_token: cartToken,
      email,
      phone: text(form, "phone", 40),
      first_name: address.first_name,
      last_name: address.last_name,
      shipping_address: address,
      billing_address: billing,
      discount_code: text(form, "discount_code", 64),
      marketing_opt_in: form.get("marketing_opt_in") === "on",
      note: text(form, "note", 500),
      // Attribution. The session key ties this order back to the
      // analytics_sessions row holding referrer, geo and device; the rest is
      // snapshotted onto the order so it survives the 400-day session prune.
      session_key: text(form, "session_key", 64),
      referrer: text(form, "referrer", 512),
      landing_path: landingPath,
      utm: readUtm(landingPath),
    },
  });

  if (error) {
    // Anything without our SQLSTATE is a fault, not a shopper problem — saying
    // so plainly beats printing a Postgres constraint name at someone who is
    // trying to buy a t-shirt.
    return {
      error:
        error.code === SHOPPER_VISIBLE
          ? error.message
          : "Something went wrong placing your order. Nothing has been charged — please try again.",
      field: null,
    };
  }

  const result = data as { checkout_token?: string; order_id?: string } | null;
  if (!result?.checkout_token) {
    return {
      error: "Something went wrong placing your order. Please try again.",
      field: null,
    };
  }

  // The cart row is already gone, deleted inside the transaction. Dropping the
  // cookie stops the next request resurrecting an empty one.
  await clearCartCookie();

  // Hand the order to the print supplier, if auto-send is on.
  //
  // Deliberately outside the transaction and after the response: fulfillment is
  // a downstream consequence of the order, not a condition of it. Qikink being
  // slow, rate-limited or down must never cost a shopper their checkout, and a
  // failed push is already recorded on qikink_fulfillments for the operator to
  // retry from the order page. `after` runs it once the redirect is on its way,
  // so nobody waits on two HTTP calls to another provider.
  if (result.order_id) {
    const orderId = result.order_id;
    after(async () => {
      try {
        const { getQikinkConfig } = await import("@/lib/qikink/config");
        const config = await getQikinkConfig();
        if (!config?.autoSend) return;
        const { pushOrderToQikink } = await import("@/lib/qikink/fulfillment");
        await pushOrderToQikink(orderId);
      } catch {
        // Swallowed on purpose. The order is placed and the shopper has been
        // redirected; there is no one left to tell, and pushOrderToQikink has
        // already persisted anything worth reading.
      }
    });
  }

  // Throws a control-flow exception, so nothing below runs. The confirmation
  // page lives under the ordinary storefront shell on purpose: the shopper has
  // finished, and the next thing they might want is to keep looking.
  redirect(`/orders/${result.checkout_token}`);
}

/* -------------------------------------------------------------------------- */
/* Discount preview                                                            */
/* -------------------------------------------------------------------------- */

export interface DiscountQuote {
  ok: boolean;
  code: string;
  /** Money off the merchandise total. Zero for a free-shipping code. */
  amount: number;
  freeShipping: boolean;
  error: string | null;
}

/**
 * Prices a discount code before the order is placed.
 *
 * Advisory only. `place_order()` re-validates against the same rules inside the
 * transaction, so a code that expires between this call and the submission is
 * caught there — this can show a shopper a discount they narrowly miss, but it
 * can never be the reason they are charged the wrong amount.
 *
 * Runs on the anon client: `discounts` is readable under the storefront
 * policies, and a code the shopper already typed is not a secret.
 */
export async function quoteDiscount(
  code: string,
  subtotal: number
): Promise<DiscountQuote> {
  const trimmed = code.trim().slice(0, 64);
  const empty: DiscountQuote = {
    ok: false,
    code: trimmed,
    amount: 0,
    freeShipping: false,
    error: null,
  };

  if (!trimmed) return empty;

  const invalid = { ...empty, error: "That code is not valid." };

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("discounts")
      .select("*")
      .ilike("code", trimmed)
      .limit(1)
      .maybeSingle();

    const discount = data as Discount | null;
    if (!discount) return invalid;

    const now = new Date();
    const live =
      discount.status === "active" &&
      new Date(discount.starts_at) <= now &&
      (!discount.ends_at || new Date(discount.ends_at) > now) &&
      (!discount.usage_limit || discount.used_count < discount.usage_limit);

    if (!live) return { ...empty, error: "That code has expired." };

    if (discount.min_purchase && subtotal < Number(discount.min_purchase)) {
      return {
        ...empty,
        error: `This code needs a ${formatMoney(
          Number(discount.min_purchase)
        )} minimum.`,
      };
    }

    if (discount.type === "percentage") {
      return {
        ...empty,
        ok: true,
        amount: Math.round(subtotal * Number(discount.value)) / 100,
      };
    }
    if (discount.type === "fixed") {
      return {
        ...empty,
        ok: true,
        amount: Math.min(Number(discount.value), subtotal),
      };
    }
    if (discount.type === "free_shipping") {
      return { ...empty, ok: true, freeShipping: true };
    }

    // bxgy, which place_order() refuses for the reason given there.
    return { ...empty, error: "That code cannot be used at checkout yet." };
  } catch {
    return invalid;
  }
}
