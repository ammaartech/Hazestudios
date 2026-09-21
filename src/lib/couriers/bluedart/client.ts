import type { BlueDartConfig, CourierEnvironment } from "../config";

/**
 * Blue Dart's REST API on the DHL API gateway (APIGEE).
 *
 * Reference: developer.dhl.com → "Waybill (DHL eCommerce India, Blue Dart)",
 * "Authentication API" and "Shipment Tracking". The surface this store uses:
 *
 *   GET  /token/v1/login             ClientID + clientSecret headers → JWTToken
 *   POST /waybill/v1/GenerateWayBill one waybill, label PDF in the response
 *   POST /waybill/v1/CancelWaybill   before the parcel is scanned in
 *   GET  /tracking/v1?...            status and scans for an AWB
 *
 * Two layers of credentials, both required. The APIGEE app's consumer key and
 * secret mint a JWT that goes in a `JWTToken` header; then every payload also
 * carries a `Profile` with the *account's* LoginID and LicenceKey, which is how
 * the request is tied to a billing customer code. (Tracking may be licensed
 * separately from shipping — Blue Dart issues a key per API type — so the
 * config can carry a second licence key for it.)
 *
 * Blue Dart reports failure inside a 200 as often as with a status code: the
 * result object carries `IsError` and a `Status` list of `{StatusCode,
 * StatusInformation}`, and some gateway errors come back as an
 * `error-response` array. `describeError` reads all of them, so "Waybill
 * already generated for this CreditReferenceNo" reaches the operator instead of
 * "HTTP 200".
 */

export const BLUE_DART_HOSTS: Record<CourierEnvironment, string> = {
  sandbox: "https://apigateway-sandbox.bluedart.com/in/transportation",
  live: "https://apigateway.bluedart.com/in/transportation",
};

export interface BdConsignee {
  ConsigneeName: string;
  ConsigneeAddress1: string;
  ConsigneeAddress2: string;
  ConsigneeAddress3: string;
  ConsigneeAddressType: "R" | "C";
  ConsigneeAttention: string;
  ConsigneeEmailID: string;
  ConsigneeGSTNumber: string;
  ConsigneeLatitude: string;
  ConsigneeLongitude: string;
  ConsigneeMaskedContactNumber: string;
  ConsigneeMobile: string;
  ConsigneePincode: string;
  ConsigneeTelephone: string;
}

export interface BdShipper {
  CustomerName: string;
  CustomerAddress1: string;
  CustomerAddress2: string;
  CustomerAddress3: string;
  CustomerCode: string;
  CustomerEmailID: string;
  CustomerGSTNumber: string;
  CustomerLatitude: string;
  CustomerLongitude: string;
  CustomerMaskedContactNumber: string;
  CustomerMobile: string;
  CustomerPincode: string;
  CustomerTelephone: string;
  IsToPayCustomer: boolean;
  OriginArea: string;
  Sender: string;
  VendorCode: string;
}

export interface BdReturnAddress {
  ManifestNumber: string;
  ReturnAddress1: string;
  ReturnAddress2: string;
  ReturnAddress3: string;
  ReturnContact: string;
  ReturnEmailID: string;
  ReturnLatitude: string;
  ReturnLongitude: string;
  ReturnMaskedContactNumber: string;
  ReturnMobile: string;
  ReturnPincode: string;
  ReturnTelephone: string;
}

export interface BdItem {
  ItemID: string;
  ItemName: string;
  ItemValue: number;
  Itemquantity: number;
  ProductDesc1: string;
  ProductDesc2: string;
  InvoiceNumber: string;
  InvoiceDate: string;
  SellerName: string;
  SellerGSTNNumber: string;
  docType: string;
}

export interface BdServices {
  AWBNo: string;
  ActualWeight: string;
  CollectableAmount: number;
  Commodity: { CommodityDetail1: string; CommodityDetail2: string; CommodityDetail3: string };
  CreditReferenceNo: string;
  DeclaredValue: number;
  Dimensions: { Length: number; Breadth: number; Height: number; Count: number }[];
  ECCN: string;
  InvoiceNo: string;
  PDFOutputNotRequired: boolean;
  PackType: string;
  PickupDate: string;
  PickupTime: string;
  PieceCount: string;
  ProductCode: string;
  ProductType: 0 | 1;
  RegisterPickup: boolean;
  SpecialInstruction: string;
  SubProductCode: string;
  OTPBasedDelivery: number;
  OTPCode: string;
  itemdtl: BdItem[];
  noOfDCGiven: number;
}

export interface BdWaybillRequest {
  Consignee: BdConsignee;
  Shipper: BdShipper;
  Returnadds: BdReturnAddress;
  Services: BdServices;
}

export interface BdProfile {
  Api_type: string;
  LicenceKey: string;
  LoginID: string;
}

export interface BdStatus {
  StatusCode?: string;
  StatusInformation?: string;
}

export interface BdWaybillResult {
  AWBNo: string;
  /** PDF bytes, decoded from whatever encoding the gateway used. Null when not sent. */
  labelPdf: Uint8Array | null;
  DestinationArea: string | null;
  DestinationLocation: string | null;
  /** Pickup registration token, when RegisterPickup was true and it succeeded. */
  TokenNumber: string | null;
  ClusterCode: string | null;
  /** Their own status lines, informational on success. */
  Status: BdStatus[];
  raw: unknown;
}

export interface BdScan {
  scan: string;
  scanCode: string;
  scanType: string;
  date: string;
  time: string;
  location: string;
}

export interface BdTracking {
  waybill: string;
  status: string;
  statusType: string;
  statusDate: string;
  statusTime: string;
  scans: BdScan[];
  raw: unknown;
}

/** Thrown for anything the caller should show or log; carries no secret. */
export class BlueDartError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "BlueDartError";
    this.status = status;
    this.body = body;
  }
}

/* -------------------------------------------------------------------------- */
/* Token cache                                                                 */
/* -------------------------------------------------------------------------- */

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Re-mint a minute early; a token that expires mid-flight reads as 401. */
const EXPIRY_MARGIN_MS = 60_000;

/** When the JWT carries no `exp`, assume the shorter of their documented lifetimes. */
const FALLBACK_TTL_MS = 55 * 60_000;

/** Keyed by environment + client id, so sandbox and live never share a token. */
const tokens = new Map<string, CachedToken>();
const minting = new Map<string, Promise<string>>();

export function clearBlueDartTokens() {
  tokens.clear();
  minting.clear();
}

/** The `exp` claim of a JWT, in epoch ms, without verifying it (we are the audience, not the issuer). */
export function jwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function getToken(config: BlueDartConfig): Promise<string> {
  const key = `${config.environment}:${config.clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const inFlight = minting.get(key);
  if (inFlight) return inFlight;

  const pending = mint(config, key).finally(() => minting.delete(key));
  minting.set(key, pending);
  return pending;
}

async function mint(config: BlueDartConfig, key: string): Promise<string> {
  const response = await fetch(`${BLUE_DART_HOSTS[config.environment]}/token/v1/login`, {
    method: "GET",
    // Header names as their docs spell them — the gateway has been seen to
    // reject `clientid` where it accepts `ClientID`.
    headers: { ClientID: config.clientId, clientSecret: config.clientSecret, Accept: "application/json" },
    cache: "no-store",
  });

  const body = await readBody(response);
  if (!response.ok) {
    throw new BlueDartError(
      describeError(body) ?? `Blue Dart rejected the credentials (HTTP ${response.status}).`,
      response.status,
      body
    );
  }

  const token =
    typeof body === "string" ? body.trim()
    : isRecord(body) && typeof body.JWTToken === "string" ? body.JWTToken
    : "";
  if (!token) {
    throw new BlueDartError(describeError(body) ?? "Blue Dart did not return a JWT token.", response.status, body);
  }

  const exp = jwtExpiryMs(token);
  const expiresAt = exp ? exp - EXPIRY_MARGIN_MS : Date.now() + FALLBACK_TTL_MS;
  tokens.set(key, { token, expiresAt: Math.max(expiresAt, Date.now() + 10_000) });
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
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusLines(value: unknown): BdStatus[] {
  if (Array.isArray(value)) return value.filter(isRecord) as BdStatus[];
  if (isRecord(value)) {
    // The SOAP-era shape: Status → WayBillGenerationStatus → [...]
    const nested = value.WayBillGenerationStatus ?? value.WaybillGenerationstatus;
    if (Array.isArray(nested)) return nested.filter(isRecord) as BdStatus[];
    if (isRecord(nested)) return [nested as BdStatus];
    if ("StatusInformation" in value) return [value as BdStatus];
  }
  return [];
}

/**
 * Finds the result object inside whichever envelope the gateway used:
 * `{GenerateWayBillResult: {...}}`, `{CancelWaybillResult: {...}}`, an
 * `error-response` array, or the object itself.
 */
function unwrapResult(body: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(body)) return null;
  if (isRecord(body[key])) return body[key] as Record<string, unknown>;
  const errors = body["error-response"];
  if (Array.isArray(errors) && isRecord(errors[0])) return errors[0] as Record<string, unknown>;
  if (isRecord(errors)) return errors as Record<string, unknown>;
  return body;
}

/**
 * The sentence to show for a failed call, or null when nothing says failure.
 * `IsError: true` is the primary signal; the gateway's own faults use a
 * `fault`/`message` pair; and a plain string body is usually an HTML error page.
 */
export function describeError(body: unknown): string | null {
  if (typeof body === "string") return flattenHtml(body);
  if (!isRecord(body)) return null;

  const candidates: Record<string, unknown>[] = [body];
  for (const key of ["GenerateWayBillResult", "CancelWaybillResult", "ImportDataResult"]) {
    if (isRecord(body[key])) candidates.push(body[key] as Record<string, unknown>);
  }
  const errors = body["error-response"];
  if (Array.isArray(errors)) candidates.push(...(errors.filter(isRecord) as Record<string, unknown>[]));
  else if (isRecord(errors)) candidates.push(errors as Record<string, unknown>);

  for (const c of candidates) {
    const isError = c.IsError === true || c.IsError === "true";
    const lines = statusLines(c.Status)
      .map((s) => [s.StatusCode, s.StatusInformation].filter(Boolean).join(": "))
      .filter(Boolean);
    if (isError) return lines.join(" ") || "Blue Dart returned IsError without a message.";
    // The gateway's own refusals, verified live: `{"status":401,"title":
    // "Unauthorized","error-response":[{"msg":"Access to the method is not
    // allowed."}]}`. `msg` is theirs; `title` is RFC 7807's.
    for (const key of ["ErrorMessage", "ErrorDescription", "message", "Message", "msg", "detail"]) {
      const v = c[key];
      if (typeof v === "string" && v.trim()) {
        const title = typeof body.title === "string" && body.title.trim() && c !== body ? `${body.title.trim()}: ` : "";
        return `${title}${v.trim()}`;
      }
    }
    if (isRecord(c.fault)) {
      const f = c.fault as Record<string, unknown>;
      const text = typeof f.faultstring === "string" ? f.faultstring : typeof f.message === "string" ? f.message : null;
      if (text) return text;
    }
  }
  if (typeof body.title === "string" && typeof body.status === "number" && body.status >= 400) return body.title.trim();
  return null;
}

async function post<T>(config: BlueDartConfig, path: string, body: unknown): Promise<T> {
  const token = await getToken(config);
  const response = await fetch(`${BLUE_DART_HOSTS[config.environment]}${path}`, {
    method: "POST",
    headers: { JWTToken: token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await readBody(response);

  // A dead token is a 401 from the gateway itself. Not retried: the cached
  // token is dropped so the *next* call mints a fresh one, but a POST that
  // failed here may still have been processed and a second waybill for the
  // same parcel is worse than asking the operator to press the button again.
  if (response.status === 401 || response.status === 403) {
    tokens.delete(`${config.environment}:${config.clientId}`);
  }

  const message = describeError(data);
  if (!response.ok) throw new BlueDartError(message ?? `Blue Dart returned HTTP ${response.status}.`, response.status, data);
  if (message) throw new BlueDartError(message, response.status, data);
  return data as T;
}

function profile(config: BlueDartConfig, licenceKey = config.licenceKey): BdProfile {
  return { Api_type: config.apiType || "S", LicenceKey: licenceKey, LoginID: config.loginId };
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

/** Mints a token against the stored consumer key and secret; nothing is booked. */
export async function testBlueDartConnection(config: BlueDartConfig): Promise<string> {
  clearBlueDartTokens();
  await getToken(config);
  return `Token issued by ${new URL(BLUE_DART_HOSTS[config.environment]).host}`;
}

/**
 * The label PDF arrives as `AWBPrintContent`. On the JSON gateway that is a
 * byte array serialised as numbers; older gateways sent base64. Both decode
 * here so the caller only ever sees bytes.
 */
export function decodePrintContent(value: unknown): Uint8Array | null {
  if (Array.isArray(value) && value.length && value.every((n) => typeof n === "number")) {
    return Uint8Array.from(value as number[]);
  }
  if (typeof value === "string" && value.length > 20) {
    try {
      return new Uint8Array(Buffer.from(value, "base64"));
    } catch {
      return null;
    }
  }
  return null;
}

export async function generateWaybill(config: BlueDartConfig, request: BdWaybillRequest): Promise<BdWaybillResult> {
  const body = await post<unknown>(config, "/waybill/v1/GenerateWayBill", { Request: request, Profile: profile(config) });
  const result = unwrapResult(body, "GenerateWayBillResult");
  const awb = result && typeof result.AWBNo === "string" ? result.AWBNo.trim() : "";
  if (!result || !awb) {
    throw new BlueDartError(describeError(body) ?? "Blue Dart accepted the request but returned no waybill number.", undefined, body);
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    AWBNo: awb,
    labelPdf: decodePrintContent(result.AWBPrintContent),
    DestinationArea: str(result.DestinationArea),
    DestinationLocation: str(result.DestinationLocation),
    TokenNumber: str(result.TokenNumber),
    ClusterCode: str(result.ClusterCode),
    Status: statusLines(result.Status),
    // The PDF bytes are stripped before the response is stored on the shipment
    // row: they are tens of kilobytes of numbers with no diagnostic value, and
    // the label itself goes to the bucket.
    raw: { ...(isRecord(body) ? body : {}), GenerateWayBillResult: { ...result, AWBPrintContent: result.AWBPrintContent ? "[pdf]" : null } },
  };
}

export async function cancelWaybill(config: BlueDartConfig, awb: string): Promise<void> {
  const body = await post<unknown>(config, "/waybill/v1/CancelWaybill", { Request: { AWBNo: awb }, Profile: profile(config) });
  const result = unwrapResult(body, "CancelWaybillResult");
  if (result && (result.IsError === true || result.IsError === "true")) {
    throw new BlueDartError(describeError(body) ?? "Blue Dart did not cancel the waybill.", undefined, body);
  }
}

/**
 * Tracking is a GET with the credentials in the query string — their design,
 * not ours — plus the JWT. `format=json` and `scan=1` ask for a JSON body with
 * the scan history; `verno=1` is the documented version parameter.
 */
export async function trackBlueDart(config: BlueDartConfig, awb: string, trackingLicenceKey?: string): Promise<BdTracking | null> {
  const token = await getToken(config);
  const params = new URLSearchParams({
    handler: "tnt",
    action: "custawbquery",
    loginid: config.loginId,
    lickey: trackingLicenceKey || config.licenceKey,
    awb: "awb",
    numbers: awb,
    format: "json",
    verno: "1",
    scan: "1",
  });
  const response = await fetch(`${BLUE_DART_HOSTS[config.environment]}/tracking/v1?${params}`, {
    headers: { JWTToken: token, Accept: "application/json" },
    cache: "no-store",
  });
  const body = await readBody(response);
  if (response.status === 401 || response.status === 403) tokens.delete(`${config.environment}:${config.clientId}`);
  if (!response.ok) throw new BlueDartError(describeError(body) ?? `Blue Dart returned HTTP ${response.status}.`, response.status, body);

  return parseTracking(body, awb);
}

/**
 * Their tracking JSON mirrors the XML it was converted from: `ShipmentData →
 * Shipment` (one object or an array), each with `Status`, `StatusType`,
 * `StatusDate`, `StatusTime` and `Scans → ScanDetail[]`. Attributes sometimes
 * land under `@attributes`. Read defensively; nothing here is contractual.
 */
export function parseTracking(body: unknown, awb: string): BdTracking | null {
  if (!isRecord(body)) return null;
  const data = isRecord(body.ShipmentData) ? body.ShipmentData : body;
  let shipment: unknown = data.Shipment ?? data.shipment;
  if (Array.isArray(shipment)) shipment = shipment[0];
  if (!isRecord(shipment)) return null;

  const attrs = isRecord(shipment["@attributes"]) ? (shipment["@attributes"] as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

  const scansNode = isRecord(shipment.Scans) ? shipment.Scans : null;
  let details: unknown = scansNode ? scansNode.ScanDetail : shipment.ScanDetail;
  if (isRecord(details)) details = [details];
  const scans: BdScan[] = Array.isArray(details)
    ? (details.filter(isRecord) as Record<string, unknown>[]).map((d) => ({
        scan: text(d.Scan),
        scanCode: text(d.ScanCode),
        scanType: text(d.ScanType),
        date: text(d.ScanDate),
        time: text(d.ScanTime),
        location: text(d.ScannedLocation),
      }))
    : [];

  const status = text(shipment.Status);
  if (!status && !scans.length) return null;

  return {
    waybill: text(shipment.WaybillNo ?? attrs.WaybillNo) || awb,
    status,
    statusType: text(shipment.StatusType),
    statusDate: text(shipment.StatusDate),
    statusTime: text(shipment.StatusTime),
    scans,
    raw: body,
  };
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
