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
 * secret, cannot serve a token minted for the other one.
 *
 * **Qikink allows exactly one live token per client id.** Minting a second
 * immediately invalidates the first — verified directly: mint A, A works; mint
 * B, A now answers `{"error":"Invalid AccessToken or Client Id"}` while B
 * works. So this cache is not merely an optimisation to save a round trip; it
 * is what stops the integration from repeatedly shooting down its own
 * credentials. Anything that mints outside it (a second process, a script run
 * against the live account) will break requests already in flight here.
 */
const tokens = new Map<string, CachedToken>();

/** Re-mint a minute early; a token that expires mid-flight reads as auth failure. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * In-flight mints, so concurrent callers share one request.
 *
 * Without this, two requests arriving on a cold cache both mint, and the second
 * invalidates the first's token before it is ever used — the caller that "won"
 * fails with an auth error it did nothing to deserve. Awaiting a shared promise
 * means one mint per process per expiry, which is the most the API tolerates.
 */
const minting = new Map<string, Promise<string>>();

export function clearTokenCache() {
  tokens.clear();
  minting.clear();
}

async function getAccessToken(config: QikinkConfig): Promise<string> {
  const key = `${config.environment}:${config.clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  // Someone is already minting for this client; join them rather than firing a
  // second request that would invalidate theirs.
  const inFlight = minting.get(key);
  if (inFlight) return inFlight;

  const pending = mintAccessToken(config, key).finally(() => minting.delete(key));
  minting.set(key, pending);
  return pending;
}

async function mintAccessToken(config: QikinkConfig, key: string): Promise<string> {
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

/**
 * Whether a response means "your token is no longer valid".
 *
 * Matched on the message, not the status. Qikink answers a dead token with 401
 * here, but it signals other failures (rate limiting among them) inside a 200,
 * and a bare 401 also covers genuinely wrong credentials — which must NOT be
 * retried, since re-minting would fail identically. The sentence is the only
 * thing that separates "this token went stale" from "these keys are wrong".
 */
function isTokenRejection(message: string | null): boolean {
  return message != null && /invalid\s+accesstoken/i.test(message);
}

async function request<T>(
  config: QikinkConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
  /** Internal: set once a token rejection has already been retried. */
  isRetry = false
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
  const message = describeError(body);

  // Our cached token was invalidated by something outside this process — most
  // often another instance, or a script, minting against the same client id,
  // since Qikink keeps only one live token per client. The cached value is
  // simply stale, so drop it and try once more with a fresh one.
  //
  // Only for GET. A POST that failed this way may still have been processed —
  // retrying `order/create` risks a duplicate print job, which is worse than
  // surfacing the error.
  if (isTokenRejection(message) && !isRetry && init.method === "GET") {
    tokens.delete(`${config.environment}:${config.clientId}`);
    return request<T>(config, path, init, true);
  }

  if (!response.ok) {
    throw new QikinkError(
      message ?? `Qikink returned HTTP ${response.status}.`,
      response.status,
      body
    );
  }

  if (message) throw new QikinkError(message, response.status, body);

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

/**
 * How many pages `listOrders` will walk before giving up.
 *
 * At ten records a page this reaches 400 orders — comfortably past the whole
 * account today (400 walked, 0 duplicates) while bounding the worst case, since
 * an endpoint that keeps answering forever must not become an infinite loop.
 * The 30-requests-a-minute limit is the real ceiling: a full walk costs 40 of
 * them, which is why only the throttled/manual sync ever does one.
 */
const MAX_PAGES = 40;

/** Qikink's page size. Not configurable — `limit`, `size` and `per_page` are all rejected. */
const PAGE_SIZE = 10;

/**
 * Pages fetched at once.
 *
 * A single page takes about a second regardless of what else is in flight, so
 * fetching them one at a time made the full walk cost 48 seconds — a second per
 * page, forty times over, all of it latency rather than work. Six at a time
 * brings the same 400 records back in about 13 seconds with no failures.
 *
 * Kept at six deliberately: forty pages in batches of six is seven rounds, well
 * inside the thirty-requests-a-minute budget, whereas saturating the limit would
 * leave nothing for a checkout pushing an order at the same moment.
 */
const PAGE_CONCURRENCY = 6;

/**
 * Every order Qikink holds for this account, walked page by page.
 *
 * **The pagination parameter is `page_no`.** This matters more than it looks:
 * `page`, `offset`, `limit`, `per_page`, `size`, `start` and `skip` are each
 * rejected outright with `{"error":true,"message":"Invalid parameter: …"}`, so
 * the obvious names all fail loudly and it is easy to conclude the endpoint has
 * no pagination at all. It does. Without it only the newest ten orders are ever
 * visible, which silently caps the tracking page at ten rows regardless of how
 * many orders exist — measured against the merchant's own dashboard, 10 of 28
 * On Hold orders, and 10 of 400 overall.
 *
 * Paging stops on an empty page, a short page, or a page that adds nothing new.
 * That last guard is what makes this safe: an endpoint that clamps out-of-range
 * pages to the last one (or to page one) would otherwise loop until MAX_PAGES,
 * so identity is tracked by `number` and repetition ends the walk.
 *
 * `status` is deliberately not used to filter server-side even though the API
 * accepts it: `?status=On Hold` returns records whose status is plainly
 * `Cancelled` once past the first few pages. The full list is fetched and
 * classified locally instead, where the rules are ours and testable.
 */
export async function listOrders(config: QikinkConfig): Promise<QikinkRemoteOrder[]> {
  const byNumber = new Map<string, QikinkRemoteOrder>();
  const ordered: QikinkRemoteOrder[] = [];

  for (let start = 1; start <= MAX_PAGES; start += PAGE_CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(PAGE_CONCURRENCY, MAX_PAGES - start + 1) },
      (_, i) => request<QikinkRemoteOrder[]>(config, `/api/order?page_no=${start + i}`)
    );

    const results = await Promise.all(batch);

    let added = 0;
    let ended = false;

    for (const body of results) {
      if (!Array.isArray(body) || body.length === 0) {
        ended = true;
        continue;
      }

      for (const order of body) {
        // `number` is the stable identity across pages; `order_id` is too, but a
        // record missing both should still not be silently dropped.
        const key = String(order.number ?? order.order_id ?? "");
        if (key && byNumber.has(key)) continue;
        if (key) byNumber.set(key, order);
        ordered.push(order);
        added += 1;
      }

      // A short page is the last page — but the rest of this batch has already
      // been fetched, so finish folding it in before stopping.
      if (body.length < PAGE_SIZE) ended = true;
    }

    if (ended || added === 0) break;
  }

  return ordered;
}
