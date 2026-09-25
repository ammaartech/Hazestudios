import { createAdminClient } from "@/lib/supabase/admin";
import { nationalPhoneDigits } from "@/lib/shop/phone-codes";
import type { Order } from "@/lib/types";
import {
  CashfreeError,
  createCashfreeOrder,
  getCashfreeOrder,
  getCashfreeOrderPayments,
  type CashfreePayment,
  type CashfreeOrderPayload,
} from "./client";
import { SDK_MODE, getCashfreeConfig, type CashfreeMode } from "./config";

/**
 * Durable payment attempts are allocated in Postgres before any gateway call.
 * Settlement commits payment, event receipt, order status and outbox together.
 * Failed gateway calls leave the attempt available for recovery by the worker.
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
  provider: string;
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
  /**
   * The `payment_requests` row this attempt pays, or null for the whole
   * order. Decides what settling it means: a request is credited to the
   * order, a full attempt closes it.
   */
  request_id: string | null;
  session_expires_at: string | null;
  gateway_closed_at: string | null;
  gateway_environment: string | null;
  request?: CashfreeOrderPayload;
}

export type StartResult =
  | { ok: true; paymentSessionId: string; mode: CashfreeMode; orderId: string }
  | { ok: false; error: string };

export interface StartOptions {
  /**
   * Charge a payment request's amount instead of the order total. The request
   * must be open and belong to the order; the order must be cash on delivery
   * and still pending. This is the partial-COD advance.
   */
  requestId?: string;
}

/** What a settlement decided, so callers can tell "paid now" from "already". */
export interface SettleResult {
  status: PaymentStatus;
  /** True only on the call that actually flipped the order to paid. */
  newlyPaid: boolean;
}

const ATTEMPT_COLUMNS =
  "id, order_id, provider, provider_order_id, cf_order_id, cf_payment_id, payment_session_id, status, amount, currency, method, error, created_at, request_id, session_expires_at, gateway_closed_at, gateway_environment";

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
  returnUrlFor: (checkoutToken: string) => string,
  options: StartOptions = {}
): Promise<StartResult> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, error: GATEWAY_UNAVAILABLE };
  const config = await getCashfreeConfig();
  if (!config) return { ok: false, error: GATEWAY_UNAVAILABLE };
  const order = await loadOrder(orderId);
  if (!order?.checkout_token) return { ok: false, error: "Order not found." };
  if (options.requestId && !/^[0-9a-f-]{36}$/i.test(options.requestId)) {
    return { ok: false, error: "Invalid payment request." };
  }
  const { data, error } = await supabase.rpc("claim_cashfree_attempt", {
    p_order_id: orderId, p_request_id: options.requestId ?? null,
    p_environment: config.environment,
  });
  if (error || !data) return { ok: false, error: error?.code === "HZ001" ? error.message : GATEWAY_UNAVAILABLE };
  const attempt = data as PaymentAttempt;
  if (attempt.status === "success") return { ok: false, error: "This order is already paid." };
  const expires = attempt.session_expires_at ?? new Date(new Date(attempt.created_at).getTime() + 30 * 60_000).toISOString();
  if (new Date(expires).getTime() <= Date.now()) {
    return { ok: false, error: "This payment is being checked. Please try again shortly." };
  }
  if (attempt.payment_session_id) {
    return { ok: true, paymentSessionId: attempt.payment_session_id, mode: SDK_MODE[config.environment], orderId: attempt.provider_order_id };
  }
  const returnUrl = returnUrlFor(order.checkout_token);
  const candidate: CashfreeOrderPayload = {
    order_id: attempt.provider_order_id, order_amount: Number(attempt.amount), order_currency: attempt.currency,
    customer_details: {
      customer_id: customerId(order), customer_phone: nationalPhoneDigits(order.phone), customer_email: order.email,
      customer_name: [order.shipping_address?.first_name, order.shipping_address?.last_name].filter(Boolean).join(" ") || undefined,
    },
    ...(returnUrl.startsWith("https://") ? { order_meta: { return_url: returnUrl } } : {}),
    order_expiry_time: expires,
    order_note: `Order #${order.order_number}`,
  };
  // Freeze the request once. Even concurrent tabs use the same idempotency key AND body.
  const { data: frozen, error: freezeError } = await supabase.rpc("prepare_cashfree_payload", {
    p_payment_id: attempt.id, p_payload: candidate,
  });
  if (freezeError) return { ok: false, error: GATEWAY_UNAVAILABLE };
  try {
    // Recover a previously accepted request whose response was lost before issuing a POST.
    let remote;
    try {
      remote = await getCashfreeOrder(config, attempt.provider_order_id);
    } catch (cause) {
      if (!(cause instanceof CashfreeError) || cause.status !== 404) throw cause;
      try {
        remote = await createCashfreeOrder(config, frozen as CashfreeOrderPayload, attempt.id);
      } catch (createError) {
        if (!(createError instanceof CashfreeError) || createError.status !== 409) throw createError;
        remote = await getCashfreeOrder(config, attempt.provider_order_id);
      }
    }
    if (remote.order_status === "PAID") {
      await reconcileAttempt(attempt);
      return { ok: false, error: "Payment received. Refresh to see your order." };
    }
    if (remote.order_status !== "ACTIVE" || !remote.payment_session_id) {
      await reconcileAttempt(attempt);
      return { ok: false, error: "This payment session has closed. Please try again shortly." };
    }
    const { error: saveError } = await supabase.from("payments").update({
      payment_session_id: remote.payment_session_id,
      cf_order_id: remote.cf_order_id != null ? String(remote.cf_order_id) : null,
      updated_at: new Date().toISOString(),
    }).eq("id", attempt.id);
    if (saveError) throw saveError;
    return { ok: true, paymentSessionId: remote.payment_session_id, mode: SDK_MODE[config.environment], orderId: attempt.provider_order_id };
  } catch {
    // Keep the attempt recoverable: a timeout is NOT proof that creation failed.
    console.error("[commerce] payment session needs recovery", { paymentId: attempt.id });
    return { ok: false, error: GATEWAY_UNAVAILABLE };
  }
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
  paidCurrency?: string | null;
  remoteOrderStatus?: string | null;
  error?: string | null;
  response?: Record<string, unknown>;
}

/** Commit the monetary outcome and fulfillment job in one database transaction. */
export async function settlePayment(
  attempt: PaymentAttempt,
  outcome: Outcome
): Promise<SettleResult> {
  const supabase = createAdminClient();
  if (!supabase) throw new Error("Payment database unavailable");
  const { data, error } = await supabase.rpc("settle_cashfree_payment", {
    p_provider_order_id: attempt.provider_order_id, p_outcome: outcome,
  });
  if (error) throw new Error(`Payment settlement failed: ${error.code}`);
  return data as SettleResult;
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

/** A failed transaction can still belong to an ACTIVE, payable gateway order.
 * Only verified terminal gateway states permit stock release. Failures throw so
 * the durable worker can retry; the browser-facing wrapper is best effort.
 */
export async function reconcileAttempt(attempt: PaymentAttempt): Promise<SettleResult> {
  if (attempt.provider !== "cashfree") throw new Error("This payment is not a Cashfree attempt");
  if (attempt.status === "success") return { status: "success", newlyPaid: false };
  const config = await getCashfreeConfig();
  if (!config || (attempt.gateway_environment && attempt.gateway_environment !== config.environment)) {
    throw new Error("Payment gateway unavailable or environment changed");
  }
  let remote;
  try {
    remote = await getCashfreeOrder(config, attempt.provider_order_id);
  } catch (cause) {
    const expiry = new Date(attempt.session_expires_at ?? new Date(new Date(attempt.created_at).getTime() + 30 * 60_000)).getTime();
    if (cause instanceof CashfreeError && cause.status === 404 && attempt.gateway_environment === config.environment && Date.now() > expiry + 5 * 60_000) {
      return settlePayment(attempt, { status: "expired", remoteOrderStatus: "NOT_FOUND" });
    }
    throw cause;
  }
  const payments = await getCashfreeOrderPayments(config, attempt.provider_order_id);
  const payment = pickPayment(payments);
  const status: PaymentStatus = remote.order_status === "PAID" || payment?.payment_status === "SUCCESS"
    ? "success" : remote.order_status === "EXPIRED" ? "expired"
      : remote.order_status === "TERMINATED" ? "cancelled" : mapPaymentStatus(payment?.payment_status);
  return settlePayment(attempt, {
    status, remoteOrderStatus: remote.order_status,
    cfPaymentId: payment?.cf_payment_id != null ? String(payment.cf_payment_id) : null,
    method: payment?.payment_group ?? null,
    paidAmount: status === "success" ? (payment?.payment_amount ?? remote.order_amount ?? null) : null,
    paidCurrency: payment?.payment_currency ?? remote.order_currency ?? null,
    error: status === "failed" ? payment?.payment_message ?? null : null,
    response: { order: remote, payment } as unknown as Record<string, unknown>,
  });
}

/** Check every unresolved attempt, including an older session paid after a retry. */
export async function reconcilePayment(orderId: string): Promise<SettleResult> {
  const attempts = await getPaymentAttempts(orderId);
  let result: SettleResult = { status: attempts[0]?.status ?? "created", newlyPaid: false };
  for (const attempt of attempts) {
    if (attempt.status === "success") return { status: "success", newlyPaid: false };
    if (attempt.provider !== "cashfree") continue;
    if (attempt.gateway_closed_at) continue;
    try {
      result = await reconcileAttempt(attempt);
      if (result.status === "success") return result;
    } catch {
      // The durable reconciliation job retries independently of the shopper's tab.
      console.error("[commerce] reconciliation deferred", { paymentId: attempt.id });
    }
  }
  return result;
}

/** Signed events and payment changes commit together, or all roll back. */
export async function settleFromWebhook(
  providerOrderId: string, outcome: Outcome,
  event: { key: string; type: string; payload: Record<string, unknown> }
): Promise<SettleResult> {
  const supabase = createAdminClient();
  if (!supabase) throw new Error("Payment database unavailable");
  const { data, error } = await supabase.rpc("settle_cashfree_payment", {
    p_provider_order_id: providerOrderId, p_outcome: outcome,
    p_event_key: event.key, p_event_type: event.type, p_event_payload: event.payload,
  });
  if (error) throw new Error(`Webhook settlement failed: ${error.code}`);
  return data as SettleResult;
}
