import { API_VERSION, HOSTS, type CashfreeConfig } from "./config";

/**
 * Cashfree Payment Gateway API client.
 *
 * Two calls carry the whole integration: create an order, and read one back.
 * Everything else — the payment form, the method selection, 3DS, the UPI
 * intent handoff — happens inside their hosted checkout, which is the point of
 * using a gateway rather than touching card data.
 *
 * Simpler than the Qikink client next door in one respect: there is no token
 * exchange. Cashfree authenticates every request with the App ID and Secret Key
 * as headers, so there is nothing to cache and nothing to expire mid-flight.
 *
 * Stricter in another: their errors are honest. A failure is an HTTP error
 * status with a JSON body carrying `message`, `code` and `type`, rather than
 * Qikink's habit of returning failures with a 200.
 */

export interface CashfreeCustomerDetails {
  /** 3–50 alphanumeric characters. Theirs, undocumented enforcement. */
  customer_id: string;
  /** Ten digits for an Indian number — no dialling code, no separators. */
  customer_phone: string;
  customer_email?: string;
  customer_name?: string;
}

export interface CashfreeOrderPayload {
  /** Ours. 3–45 chars, unique for the lifetime of the account. */
  order_id: string;
  order_amount: number;
  order_currency: string;
  customer_details: CashfreeCustomerDetails;
  order_meta?: {
    /** Where the browser lands when a payment method forces a full redirect. */
    return_url?: string;
    /** Omitted: the webhook is registered account-wide in their dashboard. */
    notify_url?: string;
  };
  /** ISO 8601. Cashfree refuses the session after this. */
  order_expiry_time?: string;
  order_note?: string;
}

/** Cashfree's order lifecycle. `ACTIVE` means "not paid yet", not "healthy". */
export type CashfreeOrderStatus =
  | "ACTIVE"
  | "PAID"
  | "EXPIRED"
  | "TERMINATED"
  | "TERMINATION_REQUESTED";

export interface CashfreeOrder {
  cf_order_id?: string | number;
  order_id?: string;
  order_status?: CashfreeOrderStatus;
  order_amount?: number;
  order_currency?: string;
  /** Handed to the browser SDK to open checkout. Absent once an order is paid. */
  payment_session_id?: string;
  [k: string]: unknown;
}

/** One transaction against an order. An order may accumulate several. */
export interface CashfreePayment {
  cf_payment_id?: string | number;
  payment_status?:
    | "SUCCESS"
    | "NOT_ATTEMPTED"
    | "FAILED"
    | "USER_DROPPED"
    | "VOID"
    | "CANCELLED"
    | "PENDING";
  payment_amount?: number;
  payment_currency?: string;
  /** upi | credit_card | debit_card | net_banking | wallet … */
  payment_group?: string;
  payment_message?: string;
  payment_time?: string;
  [k: string]: unknown;
}

/** Thrown for anything the caller should show or log; carries no secret. */
export class CashfreeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
    /** Cashfree's machine-readable code, e.g. `order_not_found`. */
    readonly code?: string
  ) {
    super(message);
    this.name = "CashfreeError";
  }
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A gateway or WAF in front of them can answer with HTML. Keeping it as a
    // string surfaces the message instead of a parse failure masking it.
    return text;
  }
}

function describeError(body: unknown): { message: string | null; code?: string } {
  if (typeof body === "string") return { message: body.slice(0, 300) || null };
  if (!isRecord(body)) return { message: null };

  const message = typeof body.message === "string" ? body.message : null;
  const code = typeof body.code === "string" ? body.code : undefined;
  return { message, code };
}

async function request<T>(
  config: CashfreeConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" }
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${HOSTS[config.environment]}/pg${path}`, {
      method: init.method,
      headers: {
        "x-api-version": API_VERSION,
        "x-client-id": config.appId,
        "x-client-secret": config.secretKey,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch (cause) {
    // DNS, TLS, timeout. Distinguished from a rejection because the remedy is
    // different: this one is worth retrying, a 401 is not.
    throw new CashfreeError(
      "Could not reach Cashfree. Check the connection and try again.",
      undefined,
      cause instanceof Error ? cause.message : cause
    );
  }

  const body = await readBody(response);

  if (!response.ok) {
    const { message, code } = describeError(body);
    throw new CashfreeError(
      message ?? `Cashfree returned HTTP ${response.status}.`,
      response.status,
      body,
      code
    );
  }

  return body as T;
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

/** Their order id rules, checked before spending a round trip to be told. */
const ORDER_ID = /^[A-Za-z0-9_-]{3,45}$/;

/**
 * Opens a payment session.
 *
 * The `payment_session_id` that comes back is the whole product of this call:
 * it is what the browser SDK needs to render checkout, and it is scoped to this
 * order and this amount. Nothing the client sends can change either.
 */
export async function createCashfreeOrder(
  config: CashfreeConfig,
  payload: CashfreeOrderPayload
): Promise<CashfreeOrder> {
  if (!ORDER_ID.test(payload.order_id)) {
    throw new CashfreeError(
      `Cashfree needs an order id of 3–45 characters — “${payload.order_id}” is not valid.`
    );
  }
  if (!(payload.order_amount > 0)) {
    throw new CashfreeError("Cashfree will not take an order for nothing.");
  }

  return request<CashfreeOrder>(config, "/orders", {
    method: "POST",
    body: payload,
  });
}

/** One order by the id we gave it. The authority on whether it was paid. */
export async function getCashfreeOrder(
  config: CashfreeConfig,
  orderId: string
): Promise<CashfreeOrder> {
  return request<CashfreeOrder>(
    config,
    `/orders/${encodeURIComponent(orderId)}`
  );
}

/**
 * Every transaction attempted against an order.
 *
 * Read after the fact rather than trusted from the browser: this is what says
 * *which* attempt succeeded and what it was paid with, and it is the same
 * answer whether the shopper's tab survived the redirect or not.
 */
export async function getCashfreeOrderPayments(
  config: CashfreeConfig,
  orderId: string
): Promise<CashfreePayment[]> {
  const body = await request<CashfreePayment[] | CashfreePayment>(
    config,
    `/orders/${encodeURIComponent(orderId)}/payments`
  );
  if (Array.isArray(body)) return body;
  return body && body.cf_payment_id !== undefined ? [body] : [];
}

/**
 * Verifies the stored credentials.
 *
 * Asks for an order id that cannot exist. A `404` / `order_not_found` proves
 * the request authenticated and was understood — which is exactly what is being
 * tested — while a `401` or `403` proves it did not. Creating a real order to
 * find out would leave a permanent stray in the merchant's dashboard, and their
 * order ids can never be reused.
 */
export async function testConnection(config: CashfreeConfig): Promise<void> {
  try {
    await getCashfreeOrder(config, `HZPROBE${Date.now().toString(36)}`);
  } catch (cause) {
    if (cause instanceof CashfreeError && cause.status === 404) return;
    throw cause;
  }
}
