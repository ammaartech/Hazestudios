import { HOSTS, type QikinkConfig } from "./config";

/**
 * Qikink Open API client.
 *
 * The whole surface is four calls: exchange the client id and secret for an
 * access token, create an order, and read orders back. Everything else Qikink
 * does — the product catalogue, designs, "Push To Store" — is dashboard-only
 * and has no API, which is why this integration links on SKU rather than
 * syncing a catalogue.
 *
 * Two constraints shape the code below:
 *   1. Tokens last an hour, so they are cached rather than minted per request.
 *   2. Qikink allows 30 requests per minute and answers the 31st with an error
 *      body carrying HTTP 200, so failure has to be detected by shape, not by
 *      status code.
 */

export interface QikinkDesign {
  design_code: string;
  width_inches?: string;
  height_inches?: string;
  placement_sku?: string;
  design_link?: string;
  mockup_link?: string;
}

export interface QikinkLineItem {
  /** 1 = resolve the design from My Products by SKU; 0 = designs supplied here. */
  search_from_my_products: 0 | 1;
  sku: string;
  quantity: string;
  price: string;
  print_type_id?: number;
  designs?: QikinkDesign[];
}

/**
 * Every field is required *as a key*, even the ones Qikink documents as
 * optional. Their API reads `last_name` and `address2` unconditionally and dies
 * with `Undefined array key "last_name"` when they are absent — and because
 * `JSON.stringify` drops `undefined`, an optional TypeScript property is enough
 * to trigger it. So these are required `string`, and callers send `""` for
 * "none": the compiler now enforces what their runtime assumes.
 */
export interface QikinkAddress {
  first_name: string;
  last_name: string;
  address1: string;
  address2: string;
  phone: string;
  email: string;
  city: string;
  zip: string;
  province: string;
  country_code: string;
}

export interface QikinkOrderPayload {
  /**
   * Unique and never reused. Two constraints Qikink enforces but does not
   * document, both discovered by tripping them:
   *   - **max 15 characters** — "Order no. cannot exceed 15 chars"
   *   - **alphanumeric only** — "Order No cannot contain special characters";
   *     a single hyphen is enough to fail it
   * Our order numbers are plain integers, so they satisfy both. Anything that
   * prefixes, pads or separates them must keep to `[A-Za-z0-9]{1,15}`.
   */
  order_number: string;
  /** "0" self-ship, "1" Qikink ships. */
  qikink_shipping: "0" | "1";
  gateway: "COD" | "Prepaid";
  total_order_value: string;
  line_items: QikinkLineItem[];
  shipping_address?: QikinkAddress;
}

export interface QikinkCreateResult {
  message?: string;
  order_id?: number | string;
  status_code?: string;
}

export interface QikinkRemoteOrder {
  order_id: number | string;
  number?: string;
  status?: string;
  created_on?: string;
  shipping_type?: string;
  payment_type?: string;
  total_order_value?: string;
  shipping?: {
    awb?: string | null;
    tracking_link?: string | null;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** Thrown for anything the caller should show or log; carries no secret. */
export class QikinkError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "QikinkError";
  }
}

/* -------------------------------------------------------------------------- */
/* Token cache                                                                 */
/* -------------------------------------------------------------------------- */

interface CachedToken {
  token: string;
  /** Epoch ms after which the token is treated as spent. */
  expiresAt: number;
}

/**
 * Keyed by environment + client id so switching sandbox→live, or rotating the
 * secret, cannot serve a token minted for the other one. Process-local by
 * design: on a serverless instance the worst case is one extra token call after
 * a cold start, which is far cheaper than the alternative of storing tokens.
 */
const tokens = new Map<string, CachedToken>();

/** Re-mint a minute early; a token that expires mid-flight reads as auth failure. */
const EXPIRY_MARGIN_MS = 60_000;

export function clearTokenCache() {
  tokens.clear();
}

async function getAccessToken(config: QikinkConfig): Promise<string> {
  const key = `${config.environment}:${config.clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const response = await fetch(`${HOSTS[config.environment]}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ClientId: config.clientId,
      client_secret: config.clientSecret,
    }),
    cache: "no-store",
  });

  const body = await readBody(response);

  if (!response.ok) {
    // Qikink is specific here — a bad key answers 401 with
    // {"error":"Invalid client_id or client_secret"} — and that sentence is far
    // more use on the settings page than a status code, so it wins when present.
    throw new QikinkError(
      describeError(body) ?? `Qikink rejected the credentials (HTTP ${response.status}).`,
      response.status,
      body
    );
  }

  const token = isRecord(body) ? body.Accesstoken : undefined;
  if (typeof token !== "string" || !token) {
    throw new QikinkError(
      describeError(body) ?? "Qikink did not return an access token.",
      response.status,
      body
    );
  }

  const ttl = isRecord(body) && typeof body.expires_in === "number"
    ? body.expires_in * 1000
    : 3_600_000;

  tokens.set(key, { token, expiresAt: Date.now() + Math.max(ttl - EXPIRY_MARGIN_MS, 0) });
  return token;
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
    // Qikink occasionally answers with an HTML error page; keep it as a string
    // so the message surfaces instead of a parse failure masking it.
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Qikink signals several failures — rate limiting among them — inside a 200
 * response, so the body is inspected regardless of status.
 */
function describeError(body: unknown): string | null {
  if (typeof body === "string") return body.slice(0, 300) || null;
  if (!isRecord(body)) return null;
  for (const key of ["error", "message", "Message", "errors"]) {
    const value = body[key];
    if (typeof value === "string" && value) {
      // The success path also uses `message` ("Order created successfully"),
      // so only treat it as an error when nothing identifies a created order.
      if (key === "message" && (body.order_id || body.status_code === "200")) continue;
      return value;
    }
  }
  return null;
}

async function request<T>(
  config: QikinkConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" }
): Promise<T> {
  const token = await getAccessToken(config);

  const response = await fetch(`${HOSTS[config.environment]}${path}`, {
    method: init.method,
    headers: {
      ClientId: config.clientId,
      Accesstoken: token,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const body = await readBody(response);

  if (!response.ok) {
    throw new QikinkError(
      describeError(body) ?? `Qikink returned HTTP ${response.status}.`,
      response.status,
      body
    );
  }

  const problem = describeError(body);
  if (problem) throw new QikinkError(problem, response.status, body);

  return body as T;
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Verifies the stored credentials by minting a token.
 *
 * The cache is cleared first, so pressing "Test connection" after correcting a
 * secret actually tests the new one instead of reporting a cached success.
 */
export async function testConnection(config: QikinkConfig): Promise<void> {
  clearTokenCache();
  await getAccessToken(config);
}

/** See `QikinkOrderPayload.order_number` — both limits are theirs, undocumented. */
const ORDER_NUMBER = /^[A-Za-z0-9]{1,15}$/;

export async function createOrder(
  config: QikinkConfig,
  payload: QikinkOrderPayload
): Promise<QikinkCreateResult> {
  // Checked here rather than left to the server: it is a known-bad request, and
  // spending one of thirty requests a minute to be told so is a waste of the
  // budget an order might need for a retry.
  if (!ORDER_NUMBER.test(payload.order_number)) {
    throw new QikinkError(
      `Qikink needs an order number of 1–15 letters and digits only — “${payload.order_number}” is not valid.`
    );
  }

  return request<QikinkCreateResult>(config, "/api/order/create", {
    method: "POST",
    body: payload,
  });
}

/**
 * One order by Qikink's id. Their endpoint answers with either an object or a
 * single-element array depending on the account, so both are accepted.
 */
export async function fetchOrder(
  config: QikinkConfig,
  qikinkOrderId: string
): Promise<QikinkRemoteOrder | null> {
  const body = await request<QikinkRemoteOrder | QikinkRemoteOrder[]>(
    config,
    `/api/order?id=${encodeURIComponent(qikinkOrderId)}`
  );
  const order = Array.isArray(body) ? body[0] : body;
  return order && order.order_id !== undefined ? order : null;
}

export async function listOrders(config: QikinkConfig): Promise<QikinkRemoteOrder[]> {
  const body = await request<QikinkRemoteOrder[]>(config, "/api/order");
  return Array.isArray(body) ? body : [];
}
