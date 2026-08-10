import { createAdminClient } from "@/lib/supabase/admin";
import { isPrepaidMethod } from "@/lib/shop/payment-methods";
import { nationalPhoneDigits } from "@/lib/shop/phone-codes";
import type { Order } from "@/lib/types";
import {
  CashfreeError,
  createCashfreeOrder,
  getCashfreeOrder,
  getCashfreeOrderPayments,
  type CashfreePayment,
} from "./client";
import { SDK_MODE, getCashfreeConfig, type CashfreeMode } from "./config";

/**
 * Taking money for an order, and recording what happened.
 *
 * The Cashfree counterpart of `src/lib/qikink/fulfillment.ts`, and written to
 * the same rules: everything runs on the service-role client, nothing throws,
 * and every outcome — including every failure — leaves a row behind for the
 * operator to read.
 *
 * The ordering constraint that governs this whole file: `map.ts` decides
 * whether Qikink is told an order is Prepaid or COD purely from
 * `payment_status === 'paid'`. So the order must be marked paid *before* it is
 * pushed. Push first and the printer bills the customer on delivery for money
 * the store has already collected.
 */

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

export type PaymentStatus =
  | "created"
  | "pending"
  | "success"
  | "failed"
  | "user_dropped"
  | "cancelled"
  | "expired";

export interface PaymentAttempt {
  id: string;
  order_id: string;
  provider_order_id: string;
  cf_order_id: string | null;
  cf_payment_id: string | null;
  payment_session_id: string | null;
  status: PaymentStatus;
  amount: number;
  currency: string;
  method: string | null;
  error: string | null;
  created_at: string;
}

export type StartResult =
  | { ok: true; paymentSessionId: string; mode: CashfreeMode; orderId: string }
  | { ok: false; error: string };

/** What a settlement decided, so callers can tell "paid now" from "already". */
export interface SettleResult {
  status: PaymentStatus;
  /** True only on the call that actually flipped the order to paid. */
  newlyPaid: boolean;
}

const ATTEMPT_COLUMNS =
  "id, order_id, provider_order_id, cf_order_id, cf_payment_id, payment_session_id, status, amount, currency, method, error, created_at";

/** A session Cashfree will no longer honour. Half an hour is their default. */
const SESSION_MINUTES = 30;

/** Cashfree's floor, in rupees. Below it, create-order is rejected outright. */
const MINIMUM_AMOUNT = 1;

/**
 * What a shopper is told when the gateway will not open.
 *
 * Deliberately one sentence with an action in it, and deliberately the same
 * sentence for every cause — a bad key, a malformed field, a Cashfree outage.
 * None of those distinctions change what the shopper can do, and every one of
 * them leaks something about the store's configuration. The real reason goes to
 * `payments.error` and the server log.
 *
 * It names cash on delivery because that is the one thing that still works when
 * this fires, and an order stuck with no way to pay is otherwise a dead end.
 */
const GATEWAY_UNAVAILABLE =
  "We couldn't open the payment window just now. Please try again in a moment — or contact us to switch this order to cash on delivery.";

/** Statuses that mean the attempt is over, one way or another. */
const TERMINAL: readonly PaymentStatus[] = [
  "success",
  "failed",
  "user_dropped",
  "cancelled",
  "expired",
];

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL.includes(status);
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Every attempt on an order, newest first. */
export async function getPaymentAttempts(
  orderId: string
): Promise<PaymentAttempt[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("payments")
    .select(ATTEMPT_COLUMNS)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  return (data ?? []) as PaymentAttempt[];
}

/** The attempt a shopper is currently in, if any. */
export async function getLatestAttempt(
  orderId: string
): Promise<PaymentAttempt | null> {
  const [latest] = await getPaymentAttempts(orderId);
  return latest ?? null;
}

async function findAttemptByProviderOrderId(
  providerOrderId: string
): Promise<PaymentAttempt | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("payments")
    .select(ATTEMPT_COLUMNS)
    .eq("provider_order_id", providerOrderId)
    .maybeSingle();

  return (data as PaymentAttempt) ?? null;
}

async function loadOrder(orderId: string): Promise<Order | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  return (data as Order) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Starting a payment                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Cashfree wants 3–50 alphanumeric characters, and rejects our uuids for the
 * hyphens. Stripping them keeps the value a stable pointer at the same person
 * across orders, which is what their repeat-customer tooling keys on.
 */
function customerId(order: Order): string {
  if (order.customer_id) return order.customer_id.replace(/-/g, "");
  return `HZ${order.order_number}`;
}

/**
 * Opens a Cashfree session against an order that already exists.
 *
 * Order-first, deliberately. `place_order()` has already written the row,
 * decremented stock and emptied the bag inside one transaction, so the amount
 * charged here is read back from `orders.total` — never passed in, never taken
 * from the client. The money is computed in two places (checkout-totals.ts and
 * the money block of 0022) and this trusts neither: by the time a payment
 * starts, the database has already arbitrated between them.
 *
 * `returnUrl` comes from the caller because only a Server Action or Route
 * Handler may read `headers()`; this module is called from both and from
 * neither's request scope in the webhook case.
 */
export async function startCashfreePayment(
  orderId: string,
  returnUrlFor: (checkoutToken: string) => string
): Promise<StartResult> {
  const supabase = createAdminClient();
  if (!supabase) {
    return { ok: false, error: "The store is not available right now." };
  }

  const config = await getCashfreeConfig();
  if (!config) {
    return {
      ok: false,
      error: "Online payment is not connected. Add credentials in Settings → Payments.",
    };
  }

  const order = await loadOrder(orderId);
  if (!order) return { ok: false, error: "Order not found." };

  // Three refusals, each of which would otherwise be a way to charge someone
  // for something they do not owe.
  if (order.is_draft) {
    return { ok: false, error: "This is a draft order." };
  }
  if (order.payment_status === "paid") {
    return { ok: false, error: "This order is already paid." };
  }
  if (order.payment_status !== "pending") {
    return { ok: false, error: "This order is not awaiting payment." };
  }
  if (!isPrepaidMethod(order.payment_method)) {
    return { ok: false, error: "This order is not set up for online payment." };
  }
  if (!order.checkout_token) {
    return { ok: false, error: "This order has no checkout link." };
  }

  // Cashfree's floor is ₹1, and it refuses anything under with
  // "order_amount : Invalid amount entered" — which sounds like a malformed
  // field and is actually a minimum. Caught here so a 95-paise test order says
  // something true instead of spending a round trip to be told off.
  const amount = Number(order.total);
  if (!(amount >= MINIMUM_AMOUNT)) {
    return {
      ok: false,
      error: `Online payment needs a total of at least ${MINIMUM_AMOUNT}. Please choose cash on delivery for this one.`,
    };
  }

  // A Cashfree order id may never be reused, so a retry cannot simply be the
  // order number again. The attempt counter is what distinguishes the second
  // try from the first, and the unique constraint on the column is what stops
  // two concurrent clicks minting the same one.
  const attempts = await getPaymentAttempts(orderId);
  const providerOrderId = `HZ${order.order_number}A${attempts.length + 1}`;

  // Cashfree rejects a plain-HTTP return_url outright — "url should be https" —
  // and the whole create-order call fails with it, taking the payment session
  // with it. On `next dev` the honest origin *is* http://localhost:3000, so
  // sending one is not a misconfiguration to correct but a fact to work around.
  //
  // Omitted rather than faked. https://localhost:3000 is not a place, so
  // inventing it would trade an error the operator can read for a shopper
  // stranded on a dead page. Without it Cashfree simply returns them to its own
  // completion screen, and the modal flow — which is how they got here — never
  // wanted the redirect anyway. Set NEXT_PUBLIC_SITE_URL to a tunnel to get the
  // real behaviour locally.
  const returnUrl = returnUrlFor(order.checkout_token);
  const canReturn = returnUrl.startsWith("https://");

  const payload = {
    order_id: providerOrderId,
    order_amount: amount,
    order_currency: order.currency || "INR",
    customer_details: {
      customer_id: customerId(order),
      // Stored with its dialling code so a number is never ambiguous about
      // where it belongs; Cashfree is Indian and wants the plain ten digits.
      customer_phone: nationalPhoneDigits(order.phone),
      customer_email: order.email,
      customer_name:
        [order.shipping_address?.first_name, order.shipping_address?.last_name]
          .filter(Boolean)
          .join(" ") || undefined,
    },
    // A fallback, not the main path. Checkout opens in a modal over our own
    // page, but UPI intent and some 3DS flows navigate away regardless, and
    // this is where they come back to.
    //
    // notify_url is deliberately never sent: the webhook is registered once,
    // account-wide, in the Cashfree dashboard. Per-order URLs would mean every
    // order placed from a preview deployment pointing webhooks at it.
    ...(canReturn ? { order_meta: { return_url: returnUrl } } : {}),
    order_expiry_time: new Date(
      Date.now() + SESSION_MINUTES * 60_000
    ).toISOString(),
    order_note: `Order #${order.order_number}`,
  };

  let created;
  try {
    created = await createCashfreeOrder(config, payload);
  } catch (cause) {
    // Two audiences, two sentences.
    //
    // Cashfree's own message names our fields and quotes our values —
    // "order_meta.return_url : url should be https. Value received: …". That is
    // precisely what an operator needs and precisely what a customer must never
    // be shown: it is internal detail, it is unactionable by them, and a
    // checkout that prints an API error reads as a broken shop rather than a
    // temporary fault. So the detail is written to the row and the shopper gets
    // a sentence about what to do next.
    const detail =
      cause instanceof CashfreeError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : "Unknown failure creating the Cashfree order.";

    await supabase.from("payments").insert({
      order_id: orderId,
      provider_order_id: providerOrderId,
      status: "failed",
      amount,
      currency: order.currency || "INR",
      request: payload,
      response: (cause instanceof CashfreeError ? cause.body : null) ?? {},
      error: detail,
    });

    // Loud on the server, because nothing else will say it: an order that
    // cannot open a payment is invisible until someone reads the table.
    console.error(`[cashfree] create order ${providerOrderId} failed:`, detail);

    return { ok: false, error: GATEWAY_UNAVAILABLE };
  }

  const sessionId = created.payment_session_id;
  if (!sessionId) {
    const detail = "Cashfree accepted the order but returned no payment session.";
    await supabase.from("payments").insert({
      order_id: orderId,
      provider_order_id: providerOrderId,
      status: "failed",
      amount,
      currency: order.currency || "INR",
      request: payload,
      response: created as Record<string, unknown>,
      error: detail,
    });
    console.error(`[cashfree] create order ${providerOrderId}:`, detail);
    return { ok: false, error: GATEWAY_UNAVAILABLE };
  }

  const { error: insertError } = await supabase.from("payments").insert({
    order_id: orderId,
    provider_order_id: providerOrderId,
    cf_order_id: created.cf_order_id != null ? String(created.cf_order_id) : null,
    payment_session_id: sessionId,
    status: "created",
    amount,
    currency: order.currency || "INR",
    request: payload,
    response: created as Record<string, unknown>,
  });

  if (insertError) {
    // The session is live on Cashfree's side but unrecorded here, which would
    // leave a payment nothing could be reconciled against. Refusing is the
    // safer half of that trade: the shopper retries, and the abandoned session
    // expires in half an hour having charged nobody.
    return { ok: false, error: "Could not start the payment. Please try again." };
  }

  return {
    ok: true,
    paymentSessionId: sessionId,
    mode: SDK_MODE[config.environment],
    orderId: providerOrderId,
  };
}

/* -------------------------------------------------------------------------- */
/* Settling                                                                    */
/* -------------------------------------------------------------------------- */

export interface Outcome {
  status: PaymentStatus;
  cfPaymentId?: string | null;
  method?: string | null;
  /** The amount the provider says was paid, for the mismatch check. */
  paidAmount?: number | null;
  error?: string | null;
  response?: Record<string, unknown>;
}

/**
 * The one place money becomes truth.
 *
 * Every route into "this order is paid" comes through here — the webhook, and
 * the reconcile the shopper's own browser triggers when it gets back before the
 * webhook does. Both can arrive, in either order, more than once. So the whole
 * function is written to be safe to run twice:
 *
 *   - the order update is conditional on it still being `pending`, so the
 *     second caller changes nothing and knows it changed nothing;
 *   - the Qikink push short-circuits on an already-sent row;
 *   - the amount is checked against what we asked for, so a webhook claiming a
 *     different figure marks the attempt failed instead of the order paid.
 */
export async function settlePayment(
  attempt: PaymentAttempt,
  outcome: Outcome
): Promise<SettleResult> {
  const supabase = createAdminClient();
  if (!supabase) return { status: attempt.status, newlyPaid: false };

  let status = outcome.status;
  let error = outcome.error ?? null;

  // The tampered-amount guard. Cashfree's own figure has to match what we
  // asked them to charge; anything else is either a bug on one side or an
  // attempt to settle an order for less than it costs, and neither should end
  // with goods in production.
  if (
    status === "success" &&
    outcome.paidAmount != null &&
    Math.abs(Number(outcome.paidAmount) - Number(attempt.amount)) > 0.01
  ) {
    status = "failed";
    error = `Amount mismatch: expected ${attempt.amount}, gateway reported ${outcome.paidAmount}.`;
  }

  await supabase
    .from("payments")
    .update({
      status,
      cf_payment_id: outcome.cfPaymentId ?? attempt.cf_payment_id,
      method: outcome.method ?? attempt.method,
      error,
      ...(outcome.response ? { response: outcome.response } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", attempt.id);

  if (status !== "success") return { status, newlyPaid: false };

  // Conditional on purpose: `select` after `update` returns only the rows the
  // filter actually matched, so an empty result means somebody else got here
  // first. That is how two deliveries of the same event end with one push.
  const { data: flipped } = await supabase
    .from("orders")
    .update({ payment_status: "paid" })
    .eq("id", attempt.order_id)
    .eq("payment_status", "pending")
    .select("id");

  const newlyPaid = Boolean(flipped?.length);

  // Now, and only now, the printer. `payment_status` is already 'paid', which
  // is the flag map.ts reads to send this in as Prepaid rather than COD.
  //
  // Attempted on every successful settlement rather than only the flipping one:
  // an order can be marked paid by hand from the admin and then reconciled here,
  // and pushOrderToQikink is itself idempotent, so a redundant call costs a
  // short-circuit rather than a duplicate job.
  try {
    const { getQikinkConfig } = await import("@/lib/qikink/config");
    const config = await getQikinkConfig();
    if (config?.autoSend) {
      const { pushOrderToQikink } = await import("@/lib/qikink/fulfillment");
      await pushOrderToQikink(attempt.order_id);
    }
  } catch {
    // Swallowed, exactly as the COD path does. The money is banked and the
    // order is paid; a printer that cannot be reached is the operator's problem
    // to retry from the order page, not a reason to fail a webhook and have
    // Cashfree redeliver it.
  }

  return { status, newlyPaid };
}

/* -------------------------------------------------------------------------- */
/* Reconciling                                                                 */
/* -------------------------------------------------------------------------- */

/** Cashfree's payment vocabulary, mapped onto ours. */
function mapPaymentStatus(value: string | undefined): PaymentStatus {
  switch (value) {
    case "SUCCESS":
      return "success";
    case "FAILED":
      return "failed";
    case "USER_DROPPED":
      return "user_dropped";
    case "CANCELLED":
    case "VOID":
      return "cancelled";
    case "PENDING":
      return "pending";
    default:
      return "created";
  }
}

/** The most informative transaction on an order: a success, else the newest. */
function pickPayment(payments: CashfreePayment[]): CashfreePayment | null {
  if (payments.length === 0) return null;
  return payments.find((p) => p.payment_status === "SUCCESS") ?? payments[0];
}

/**
 * Asks Cashfree what actually happened, and settles on the answer.
 *
 * Pull rather than push, for the same reason `syncQikinkOrder` is: the shopper
 * can be back on our page before the webhook has left theirs, and a
 * confirmation screen that says "pending" about money already taken is the
 * thing this exists to prevent. It is also the safety net for a webhook that
 * never arrives at all — a tunnel that died, a deploy mid-delivery.
 *
 * Never throws. A gateway that cannot be reached leaves the order exactly as it
 * was, which is the correct outcome: pending is the truth until proven wrong.
 */
export async function reconcilePayment(orderId: string): Promise<SettleResult> {
  const attempt = await getLatestAttempt(orderId);
  if (!attempt) return { status: "created", newlyPaid: false };
  if (isTerminal(attempt.status) && attempt.status !== "success") {
    // Already resolved and not in our favour. Re-asking would tell us the same
    // thing and spend a request doing it.
    return { status: attempt.status, newlyPaid: false };
  }

  const config = await getCashfreeConfig();
  if (!config) return { status: attempt.status, newlyPaid: false };

  try {
    const [order, payments] = await Promise.all([
      getCashfreeOrder(config, attempt.provider_order_id),
      getCashfreeOrderPayments(config, attempt.provider_order_id).catch(
        () => [] as CashfreePayment[]
      ),
    ]);

    const payment = pickPayment(payments);

    // The order's own status is the authority on whether money arrived; the
    // payment record is where the detail lives. They can disagree briefly while
    // a transaction settles, and `order_status === 'PAID'` is the safer of the
    // two to act on.
    const status: PaymentStatus =
      order.order_status === "PAID"
        ? "success"
        : order.order_status === "EXPIRED"
          ? "expired"
          : order.order_status === "TERMINATED"
            ? "cancelled"
            : mapPaymentStatus(payment?.payment_status);

    return settlePayment(attempt, {
      status,
      cfPaymentId:
        payment?.cf_payment_id != null ? String(payment.cf_payment_id) : null,
      method: payment?.payment_group ?? null,
      paidAmount:
        status === "success"
          ? (payment?.payment_amount ?? order.order_amount ?? null)
          : null,
      error: status === "failed" ? (payment?.payment_message ?? null) : null,
      response: { order, payment } as unknown as Record<string, unknown>,
    });
  } catch {
    return { status: attempt.status, newlyPaid: false };
  }
}

/**
 * Settles a signed webhook against the attempt it names.
 *
 * The webhook carries everything needed, so unlike `reconcilePayment` this does
 * not call back out to Cashfree — the signature already proved the payload came
 * from them, and a round trip would only add a way for the handler to time out
 * and be redelivered.
 */
export async function settleFromWebhook(
  providerOrderId: string,
  outcome: Outcome
): Promise<SettleResult | null> {
  const attempt = await findAttemptByProviderOrderId(providerOrderId);
  if (!attempt) return null;
  return settlePayment(attempt, outcome);
}
