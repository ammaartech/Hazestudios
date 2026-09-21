import type { ShreeMarutiConfig, CourierEnvironment } from "../config";

/**
 * Shree Maruti's e-commerce API — the InnoFulfill platform (branded SMILE),
 * which is what sits behind shreemaruti.com's e-bookings and tracking.
 *
 * Reference: https://docs.innofulfill.com (the "APIs v2" set). The surface this
 * store uses:
 *
 *   POST /auth/login                                   email+password → id_token
 *   POST /gateway/booking-service/orders               book a FORWARD ECOMM order
 *   GET  /gateway/booking-service/orders/{orderId}     read it back
 *   POST /gateway/booking-service/orders/cancel/bulk   cancel before pickup
 *   POST /gateway/booking-service/orders/manifest/bulk mark ready for dispatch
 *   POST /gateway/pdf-generator/shipping-label         label PDF
 *   GET  /gateway/tracking-v2/api/tracking/awb/{awb}   status + scan history
 *   POST /gateway/serviceability/ecomm                 can they deliver there?
 *
 * Authentication is either an `api-key` header from the portal, or a Bearer
 * `id_token` plus a `tenantid` header from `/auth/login`. The token lasts 24
 * hours and is cached per process; the refresh-token flow is deliberately not
 * used — refresh tokens are single-use, and two instances rotating the same
 * one would invalidate each other. Logging in again is cheap and idempotent.
 *
 * Every response carries an envelope of one of two shapes — `{status,
 * statusCode, message, data}` or `{error: {code, message, details}}` — and a
 * few return `{status_code, message}` instead. `describeError` reads all three
 * so a validation failure names the field rather than the status code.
 */

export const SHREE_MARUTI_HOSTS: Record<CourierEnvironment, string> = {
  sandbox: "https://sandbox.apis.innofulfill.com",
  live: "https://apis.innofulfill.com",
};

/** Static identifiers the docs say to send on every ECOMM order. */
export const ECOMM_CARRIER = {
  carrierName: "innofulfill_ecomm",
  carrierId: "dee69b40-c0f3-4a44-879a-8b6f6849efaa",
} as const;

export interface SmAddress {
  type: "PICKUP" | "DELIVERY" | "BILLING" | "RETURN";
  zip: string;
  name: string;
  phone: string;
  email: string;
  street: string;
  landmark: string;
  city: string;
  state: string;
  country: string;
  addressName: string;
  GSTNumber?: string;
}

export interface SmItem {
  name: string;
  quantity: number;
  unitPrice: number;
  sku: string;
  hsnCode: string;
  description: string;
}

export interface SmShipment {
  dimensions: { length: number; width: number; height: number };
  shipmentStatus: "CONFIRMED";
  awbNumber: string;
  physicalWeight: number;
  physicalWeightUnit: "KG";
  volumetricWeight: number;
  note: string;
  items: SmItem[];
}

export interface SmOrderPayload {
  referenceId: string;
  orderDate: string;
  orderType: "FORWARD";
  orderStatus: "CONFIRMED";
  parcelCategory: "ECOMM";
  deliveryPromise: "ECOMM";
  deliveryMode: "SURFACE" | "AIR";
  autoManifest: boolean;
  eWaybills: string[];
  documentType: string;
  taxes: unknown[];
  discounts: unknown[];
  metadata: Record<string, string>;
  documents: unknown[];
  addresses: SmAddress[];
  shipments: SmShipment[];
  carrierId: string;
  carrierName: string;
  payment: {
    type: "PREPAID" | "COD";
    currency: string;
    paymentMethod: "ONLINE" | "CASH";
    customerCharges: { chargeKey: string; chargeValue: number; breakup: unknown[] }[];
    breakdown: { subTotal: number };
  };
}

export interface SmOrder {
  id?: number;
  orderId: string;
  referenceId?: string;
  orderStatus?: string;
  shipments?: { awbNumber?: string; shipmentStatus?: string }[];
  [k: string]: unknown;
}

export interface SmTracking {
  orderInformation?: {
    trackingId?: string;
    currentStatus?: string;
    orderId?: string;
    [k: string]: unknown;
  };
  statuses?: {
    status?: string;
    provider_status?: string;
    location?: string;
    statusTimestamp?: number | string;
    event?: string;
    category?: string;
    createdAt?: string;
  }[];
}

export interface SmServiceability {
  serviceable: boolean;
  reason: string;
  destination?: { city?: string; state?: string; zone?: string; category?: string };
}

/** Thrown for anything the caller should show or log; carries no secret. */
export class ShreeMarutiError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "ShreeMarutiError";
    this.status = status;
    this.body = body;
  }
}

/* -------------------------------------------------------------------------- */
/* Session cache (password mode only)                                          */
/* -------------------------------------------------------------------------- */

interface Session {
  idToken: string;
  tenantId: string;
  userId: string;
  expiresAt: number;
}

/** Re-login a few minutes early; a token that dies mid-request reads as 401. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

const sessions = new Map<string, Session>();
const logins = new Map<string, Promise<Session>>();

export function clearShreeMarutiSessions() {
  sessions.clear();
  logins.clear();
}

async function login(config: ShreeMarutiConfig): Promise<Session> {
  const key = `${config.environment}:${config.username}`;
  const cached = sessions.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const inFlight = logins.get(key);
  if (inFlight) return inFlight;

  const pending = (async () => {
    const response = await fetch(`${SHREE_MARUTI_HOSTS[config.environment]}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: config.username, password: config.password, signinType: "EMAIL" }),
      cache: "no-store",
    });
    const body = await readBody(response);
    if (!response.ok) {
      throw new ShreeMarutiError(
        describeError(body) ?? `Shree Maruti rejected the login (HTTP ${response.status}).`,
        response.status,
        body
      );
    }
    const record = isRecord(body) ? body : {};
    const idToken = typeof record.id_token === "string" ? record.id_token : "";
    if (!idToken) throw new ShreeMarutiError("Shree Maruti did not return an id token.", response.status, body);

    const ttl = typeof record.expires_in === "number" ? record.expires_in * 1000 : 86_400_000;
    const session: Session = {
      idToken,
      tenantId: String(record.tenant_id ?? config.tenantId ?? ""),
      userId: String(record.user_id ?? config.userId ?? ""),
      expiresAt: Date.now() + Math.max(ttl - EXPIRY_MARGIN_MS, 60_000),
    };
    sessions.set(key, session);
    return session;
  })().finally(() => logins.delete(key));

  logins.set(key, pending);
  return pending;
}

/**
 * The tenant and user ids for this account — from settings when entered,
 * otherwise from a login when one is possible. The label endpoint needs both.
 */
export async function resolveIdentity(config: ShreeMarutiConfig): Promise<{ tenantId: string; userId: string }> {
  if (config.tenantId && config.userId) return { tenantId: config.tenantId, userId: config.userId };
  if (config.authMode === "password") {
    const session = await login(config);
    return { tenantId: config.tenantId || session.tenantId, userId: config.userId || session.userId };
  }
  return { tenantId: config.tenantId, userId: config.userId };
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the human sentence out of any of their error envelopes. Validation
 * failures carry a `details` list naming fields; those are folded in, because
 * "toPincode must be a valid 6-digit Indian pincode" is the message the
 * operator needs and "Invalid request." is not.
 */
export function describeError(body: unknown): string | null {
  // A string body is their edge answering for a service that is down — an
  // HTML 503 page, seen live from the sandbox host. Flattened to its words.
  if (typeof body === "string") return flattenHtml(body);
  if (!isRecord(body)) return null;

  const error = isRecord(body.error) ? body.error : null;
  const container = error ?? (isRecord(body.errors) ? body.errors : null) ?? body;

  const details = collectDetails(container.details) ?? collectDetails(container.errors) ?? collectDetails(body.errors);
  const message =
    typeof container.message === "string" ? container.message
    : typeof body.message === "string" ? body.message
    : null;

  if (error || body.status === "error" || body.success === false || typeof body.status_code === "number" && body.status_code >= 400) {
    const text = [message, details].filter(Boolean).join(" ");
    return text || "Shree Maruti returned an error without a message.";
  }
  return null;
}

function collectDetails(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts = value
    .map((d) => (isRecord(d) && typeof d.message === "string" ? d.message : null))
    .filter((m): m is string => Boolean(m));
  return parts.length ? parts.join(" ") : null;
}

async function authHeaders(config: ShreeMarutiConfig): Promise<Record<string, string>> {
  if (config.authMode === "api_key") return { "api-key": config.apiKey };
  const session = await login(config);
  return { Authorization: `Bearer ${session.idToken}`, tenantid: config.tenantId || session.tenantId };
}

async function request<T>(
  config: ShreeMarutiConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
  isRetry = false
): Promise<T> {
  const response = await fetch(`${SHREE_MARUTI_HOSTS[config.environment]}${path}`, {
    method: init.method,
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(await authHeaders(config)),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const body = await readBody(response);

  // A cached id token that has been invalidated — password changed, session
  // revoked on their side — reads as 401. Log in once more and retry, but only
  // for reads: a POST that failed this way may still have been processed, and
  // retrying a booking risks a second AWB.
  if (response.status === 401 && config.authMode === "password" && !isRetry && init.method === "GET") {
    sessions.delete(`${config.environment}:${config.username}`);
    return request<T>(config, path, init, true);
  }

  const message = describeError(body);
  if (!response.ok) {
    throw new ShreeMarutiError(message ?? `Shree Maruti returned HTTP ${response.status}.`, response.status, body);
  }
  if (message) throw new ShreeMarutiError(message, response.status, body);

  return body as T;
}

/** The `data` member of a success envelope, or the body itself when unwrapped. */
function unwrap<T>(body: unknown): T {
  if (isRecord(body) && "data" in body && body.data !== undefined) return body.data as T;
  return body as T;
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Proves the credentials work without booking anything: a login in password
 * mode, and a serviceability check between two well-known pincodes in API-key
 * mode — the cheapest authenticated call they offer.
 */
export async function testShreeMarutiConnection(config: ShreeMarutiConfig): Promise<string> {
  clearShreeMarutiSessions();
  if (config.authMode === "password") {
    const session = await login(config);
    return `Signed in — tenant ${session.tenantId || "unknown"}`;
  }
  await checkServiceability(config, { from: "400008", to: "400063", paymentMode: "PREPAID" });
  return "API key accepted";
}

export async function createShreeMarutiOrder(config: ShreeMarutiConfig, payload: SmOrderPayload): Promise<SmOrder> {
  const body = await request<unknown>(config, "/gateway/booking-service/orders", { method: "POST", body: payload });
  const order = unwrap<SmOrder>(body);
  if (!isRecord(order) || typeof order.orderId !== "string" || !order.orderId) {
    throw new ShreeMarutiError("Shree Maruti accepted the request but returned no order id.", undefined, body);
  }
  return order;
}

export async function fetchShreeMarutiOrder(config: ShreeMarutiConfig, orderId: string): Promise<SmOrder | null> {
  try {
    const body = await request<unknown>(config, `/gateway/booking-service/orders/${encodeURIComponent(orderId)}`);
    const order = unwrap<SmOrder>(body);
    return isRecord(order) && typeof order.orderId === "string" ? order : null;
  } catch (cause) {
    if (cause instanceof ShreeMarutiError && cause.status === 404) return null;
    throw cause;
  }
}

export async function cancelShreeMarutiOrder(config: ShreeMarutiConfig, orderId: string, reason: string): Promise<void> {
  const body = await request<unknown>(config, "/gateway/booking-service/orders/cancel/bulk", {
    method: "POST",
    body: { orders: [{ orderId, reason: reason.trim() || "Cancelled by merchant" }] },
  });
  const data = unwrap<{ cancelledCount?: number; orderIds?: string[] }>(body);
  if (isRecord(data) && typeof data.cancelledCount === "number" && data.cancelledCount < 1) {
    throw new ShreeMarutiError("Shree Maruti did not cancel the order — it may already be picked up.", undefined, body);
  }
}

export async function manifestShreeMarutiOrders(config: ShreeMarutiConfig, orderIds: string[]): Promise<void> {
  if (!orderIds.length) return;
  await request(config, "/gateway/booking-service/orders/manifest/bulk", { method: "POST", body: { orderIds } });
}

export async function trackShreeMaruti(config: ShreeMarutiConfig, awb: string): Promise<SmTracking | null> {
  try {
    const body = await request<unknown>(config, `/gateway/tracking-v2/api/tracking/awb/${encodeURIComponent(awb)}`);
    const data = unwrap<SmTracking>(body);
    return isRecord(data) ? (data as SmTracking) : null;
  } catch (cause) {
    if (cause instanceof ShreeMarutiError && cause.status === 404) return null;
    throw cause;
  }
}

export async function checkServiceability(
  config: ShreeMarutiConfig,
  input: { from: string; to: string; paymentMode: "PREPAID" | "COD" }
): Promise<SmServiceability> {
  const body = await request<unknown>(config, "/gateway/serviceability/ecomm", {
    method: "POST",
    body: {
      fromPincode: Number(input.from),
      toPincode: Number(input.to),
      paymentMode: input.paymentMode,
      operationType: "PICKUP_DELIVERY",
      carriers: ["SMILE"],
    },
  });
  const data = unwrap<unknown>(body);
  const first = Array.isArray(data) ? data[0] : data;
  if (!isRecord(first)) return { serviceable: false, reason: "No serviceability data returned." };

  const carriers = Array.isArray(first.carriers) ? first.carriers : [];
  const smile = carriers.find((c) => isRecord(c)) as Record<string, unknown> | undefined;
  const meta = isRecord(first.toPincodeMetadata) ? first.toPincodeMetadata : {};

  return {
    serviceable: smile?.serviceable === true,
    reason: typeof smile?.reason === "string" ? smile.reason : "",
    destination: {
      city: typeof meta.city === "string" ? meta.city : undefined,
      state: typeof meta.state === "string" ? meta.state : undefined,
      zone: typeof meta.zone === "string" ? meta.zone : undefined,
      category: typeof meta.category === "string" ? meta.category : undefined,
    },
  };
}

/**
 * The label PDF. Their docs say the response is "a binary stream or a base64
 * encoded string", so both are handled: a PDF content type is taken as bytes,
 * anything JSON is searched for a base64 `data` member.
 */
export async function fetchShreeMarutiLabel(config: ShreeMarutiConfig, orderId: string): Promise<Uint8Array> {
  const identity = await resolveIdentity(config);
  if (!identity.tenantId || !identity.userId) {
    throw new ShreeMarutiError(
      "Shree Maruti labels need the account's tenant ID and user ID. Add them in Settings → Shipping, or switch to email + password sign-in."
    );
  }

  const response = await fetch(`${SHREE_MARUTI_HOSTS[config.environment]}/gateway/pdf-generator/shipping-label`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/pdf, application/json",
      ...(await authHeaders(config)),
    },
    body: JSON.stringify({ orderId, tenantId: identity.tenantId, userId: identity.userId }),
    cache: "no-store",
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (response.ok && /pdf|octet-stream/i.test(contentType)) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const body = await readBody(response);
  const message = describeError(body);
  if (!response.ok) throw new ShreeMarutiError(message ?? `Shree Maruti returned HTTP ${response.status}.`, response.status, body);
  if (message) throw new ShreeMarutiError(message, response.status, body);

  const data = unwrap<unknown>(body);
  const base64 = typeof data === "string" ? data : isRecord(data) && typeof data.pdf === "string" ? data.pdf : null;
  if (!base64) throw new ShreeMarutiError("Shree Maruti returned no label content.", response.status, body);
  return new Uint8Array(Buffer.from(base64.replace(/^data:application\/pdf;base64,/, ""), "base64"));
}

/**
 * An HTML error page as one line. The `<title>` and the `<h1>` of such pages
 * say the same thing, so a phrase repeated back-to-back is collapsed — "503
 * Service Temporarily Unavailable", not that twice.
 */
function flattenHtml(html: string): string | null {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const half = Math.floor(text.length / 2);
  const once =
    text.length % 2 === 1 && text.slice(0, half) === text.slice(half + 1) && text[half] === " "
      ? text.slice(0, half)
      : text;
  return once.slice(0, 300);
}
