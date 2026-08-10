"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCashfreeConfig, type CashfreeMode } from "@/lib/cashfree/config";
import {
  reconcilePayment,
  startCashfreePayment,
} from "@/lib/cashfree/payment";
import { clearCartCookie, readCartToken } from "@/lib/shop/cart";
import { isPayableMethod, isPrepaidMethod } from "@/lib/shop/payment-methods";
import { formatPhone } from "@/lib/shop/phone-codes";
import { lookupPincode, type PincodeArea } from "@/lib/shop/pincode";
import { phoneProblem, postalCodeProblem } from "@/lib/shop/validate";
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

/** Everything the browser needs to open Cashfree, and nothing more. */
export interface PaymentHandoff {
  /** Scoped by Cashfree to one order and one amount. Not a credential. */
  sessionId: string;
  mode: CashfreeMode;
  /** Where to land once the window closes, paid or not. */
  token: string;
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
  //
  // province is required alongside the rest: Qikink's create-order call fails
  // outright without it (src/lib/qikink/map.ts), and unlike postal_code that
  // was never enforced here until now.
  const required: [keyof typeof address, string][] = [
    ["first_name", "Enter a first name."],
    ["last_name", "Enter a last name."],
    ["address1", "Enter a street address."],
    ["city", "Enter a city."],
    ["province", "Enter a state or province."],
    ["country", "Choose a country."],
  ];
  for (const [field, message] of required) {
    if (!address[field]) return { error: message, field };
  }

  // Shape, not just presence, and from the same module the form validates
  // against — so a number the field ticked green is never one this rejects.
  const postalProblem = postalCodeProblem(address.postal_code, address.country);
  if (postalProblem) return { error: postalProblem, field: "postal_code" };

  // The number and the country it dials from arrive as two inputs. Validated
  // against the *phone's* country, not the delivery country — someone abroad
  // may well be shipping to an Indian address, and the ten-digit rule belongs
  // to the number rather than the destination.
  const phoneCountry = text(form, "phone_country", 2).toUpperCase();
  const phone = text(form, "phone", 40);

  const phoneIssue = phoneProblem(phone, phoneCountry || address.country);
  if (phoneIssue) return { error: phoneIssue, field: "phone" };

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

  // A disabled radio stops a browser, not a request. `isPayableMethod` checks
  // the method is one the store can actually collect through today, which is a
  // stricter question than the one place_order() asks: the function accepts any
  // well-formed method, because an order awaiting payment is a legitimate row.
  // What must not happen is this action minting one before there is a gateway
  // to settle it.
  const paymentMethod = text(form, "payment_method", 16);
  if (!isPayableMethod(paymentMethod)) {
    return { error: "Choose a payment method.", field: "payment_method" };
  }

  // The second half of that gate, and the half that needs a database read.
  // `isPayableMethod` knows which methods the store offers; only this knows
  // whether the one they picked has a gateway switched on behind it right now.
  // Checked before the order is written, because an order placed with no way to
  // pay for it is worse than a rejected submission.
  if (isPrepaidMethod(paymentMethod) && !(await getCashfreeConfig())) {
    return {
      error:
        "Online payment is unavailable right now — please choose cash on delivery.",
      field: "payment_method",
    };
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
      // Stored with its dialling code, so a number is never ambiguous about
      // which country it belongs to. `nationalPhoneDigits` recovers the plain
      // ten digits for Qikink, which is an Indian printer and wants those.
      phone: formatPhone(phone, phoneCountry || address.country),
      first_name: address.first_name,
      last_name: address.last_name,
      shipping_address: address,
      billing_address: billing,
      payment_method: paymentMethod,
      discount_code: text(form, "discount_code", 64),
      marketing_opt_in: form.get("marketing_opt_in") === "on",
      // What to file this address under in the shopper's book. Blank is fine —
      // place_order() falls back to "Home", which is the right guess for a
      // first address and harmless for a guest who will never see the book.
      address_label: text(form, "address_label", 24),
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
  //
  // COD only, and this is the part that has to stay true as payment methods are
  // added. map.ts reports an order to Qikink as Prepaid or COD purely on
  // `payment_status === 'paid'`, and a prepaid order is pending at this point —
  // so auto-sending one would put goods into production, billed to the customer
  // on delivery, for money the store is separately about to ask for. A prepaid
  // order is pushed by `settlePayment` instead, the moment its payment lands
  // and not a step before.
  if (result.order_id && paymentMethod === "cod") {
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

  // Every path leaves this page, prepaid included, and that is load-bearing
  // rather than tidy.
  //
  // A Server Action that *returns* makes Next re-render the route it was called
  // from. `place_order()` has just deleted the cart, so a re-rendered /checkout
  // finds an empty bag and fires its own redirect to /cart — taking any payment
  // window opened from this page with it. The first version of this returned a
  // payment session here to save a page load, and that is exactly what it
  // bought: a shopper on /cart, an unpaid order, and no popup.
  //
  // So the payment window belongs on the order page, which is stable, reachable
  // by its own token, and already has the retry and the reconcile. This is a
  // page load slower and is the only version that works.
  redirect(`/orders/${result.checkout_token}`);
}

/* -------------------------------------------------------------------------- */
/* Payment                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where Cashfree sends a browser back to.
 *
 * Only needed by the payment methods that navigate away — UPI intent, some 3DS
 * flows — but it has to be an absolute URL, and the only place that knows this
 * deployment's own origin is the request. `NEXT_PUBLIC_SITE_URL` overrides it
 * for the case where a proxy rewrites the host into something the public
 * internet cannot reach back to.
 *
 * `?cf=1` is not read for anything security-relevant. It only tells the status
 * page that this arrival came from a payment, so it can check before rendering
 * rather than after.
 */
async function paymentReturnUrl(): Promise<(token: string) => string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");

  let origin = configured ?? "";
  if (!origin) {
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    const proto =
      headerList.get("x-forwarded-proto") ??
      (host?.startsWith("localhost") ? "http" : "https");
    origin = host ? `${proto}://${host}` : "";
  }

  return (token: string) => `${origin}/orders/${token}?cf=1`;
}

/**
 * Resolves an order from the bearer token in its URL.
 *
 * The same authorisation `getOrderByToken` uses and for the same reason: the
 * token is 256 bits of unguessable, matched exactly, and holding it is what
 * makes someone this order's owner. Malformed tokens never reach the database.
 */
async function orderIdForToken(token: string): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;

  const admin = createAdminClient();
  if (!admin) return null;

  const { data } = await admin
    .from("orders")
    .select("id")
    .eq("checkout_token", token)
    .maybeSingle();

  return (data?.id as string) ?? null;
}

/**
 * Asks Cashfree what happened, then sends the shopper to their order.
 *
 * Called when the payment window closes, whichever way it closed. The answer is
 * never taken from the browser — the SDK's result decides only *when* to ask,
 * and `reconcilePayment` reads the outcome from Cashfree's own record. That
 * distinction is the entire security model of the client half of this flow: a
 * forged POST to this action can, at most, make the server double-check an
 * order it already knows the status of.
 */
export async function confirmPayment(token: string): Promise<void> {
  const orderId = await orderIdForToken(token);
  if (orderId) {
    try {
      await reconcilePayment(orderId);
    } catch {
      // The order page is the right place to be either way, and it reconciles
      // again on arrival. Failing here would strand the shopper on checkout.
    }
  }

  redirect(`/orders/${token}`);
}

/**
 * Opens a fresh payment window for an order that is still unpaid.
 *
 * The recovery path for every way the first attempt can end without money: a
 * closed modal, a declined card, a gateway that was down when the order was
 * placed, a phone that ran out of battery on the UPI app. Each call mints a new
 * Cashfree order — theirs may never be reused — against the same order of ours.
 *
 * Safe to expose to anyone holding the token, because it cannot do anything to
 * an order that is already paid: `startCashfreePayment` refuses on any status
 * but pending.
 */
export async function retryPayment(
  token: string
): Promise<{ ok: true; payment: PaymentHandoff } | { ok: false; error: string }> {
  const orderId = await orderIdForToken(token);
  if (!orderId) return { ok: false, error: "We could not find that order." };

  // Cheap insurance against paying twice: if a webhook landed while this page
  // was open, the order is already paid and the button should not have been
  // there. Reconciling first turns that into an honest refusal.
  try {
    await reconcilePayment(orderId);
  } catch {
    // Advisory. startCashfreePayment re-reads the order and refuses on its own.
  }

  const started = await startCashfreePayment(orderId, await paymentReturnUrl());
  if (!started.ok) return { ok: false, error: started.error };

  return {
    ok: true,
    payment: {
      sessionId: started.paymentSessionId,
      mode: started.mode,
      token,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* PIN code lookup                                                             */
/* -------------------------------------------------------------------------- */

/**
 * City and state for an Indian PIN code.
 *
 * Advisory, exactly like `quoteDiscount`: the shopper can overwrite whatever
 * comes back, and `place_order()` validates the address it is actually given.
 * Its value is that the two fields most often mistyped — district, and the
 * spelling of a state Qikink matches on by name — get filled in correctly
 * without anyone typing them.
 */
export async function resolvePincode(pin: string): Promise<PincodeArea | null> {
  return lookupPincode(pin.trim().slice(0, 6));
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
