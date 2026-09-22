import type { CourierEnvironment, DtdcConfig } from "../config";

/**
 * DTDC's customer integration API, and its separate tracking API.
 *
 * DTDC runs bookings on Shipsy's platform: `https://dtdcapi.shipsy.io/api`
 * (demo: `https://demodashboardapi.shipsy.in/api`), authenticated with a
 * single `api-key` header. The surface this store uses there:
 *
 *   POST customer/integration/consignment/softdata            book → consignment no.
 *   POST customer/integration/consignment/cancel              before pickup
 *   GET  customer/integration/consignment/shippinglabel/stream label PDF
 *
 * Tracking is a different DTDC system entirely (`blktracksvc.dtdc.com`), with
 * its own credentials: a username and password exchanged at
 * `/dtdc-api/api/dtdc/authenticate` for a token that then rides in an
 * `X-Access-Token` header on `/dtdc-api/rest/JSONCnTrk/getTrackDetails`.
 * Some accounts are issued the token directly; the config allows either.
 *
 * Serviceability comes from a third, public endpoint — DTDC's rate-calculator
 * pincode lookup — which needs no credentials at all (and, notably, answers
 * only over plain HTTP; nothing secret is sent to it, only two pincodes).
 *
 * Verified live 2026-09-21: both Shipsy hosts answer a bad key with
 * `{"error":{"message":"Wrong api key","statusCode":401,"reason":"WRONG_API_KEY"}}`,
 * the tracking host with `{"status":401,"error":"Unauthorized","message":…}`,
 * and the pincode lookup with `ZIPCODE_RESP[0].MESSAGE = "SUCCESS"` plus a
 * `SERV_LIST` of per-service YES/NO flags.
 */

export const DTDC_HOSTS: Record<CourierEnvironment, string> = {
  sandbox: "https://demodashboardapi.shipsy.in/api",
  live: "https://dtdcapi.shipsy.io/api",
};

export const DTDC_TRACKING_HOSTS: Record<CourierEnvironment, string> = {
  sandbox: "https://dtdcstagingapi.dtdc.com/dtdc-tracking-api",
  live: "https://blktracksvc.dtdc.com",
};

const DTDC_PINCODE_URL = "http://smarttrack.ctbsplus.dtdc.com/ratecalapi/PincodeApiCall";

export interface DtdcParty {
  name: string;
  phone: string;
  alternate_phone: string;
  address_line_1: string;
  address_line_2: string;
  pincode: string;
  city: string;
  state: string;
}

export interface DtdcPiece {
  description: string;
  declared_value: string;
  weight: string;
  height: string;
  length: string;
  width: string;
}

export interface DtdcConsignment {
  customer_code: string;
  service_type_id: string;
  load_type: "NON-DOCUMENT" | "DOCUMENT";
  description: string;
  dimension_unit: "cm";
  length: string;
  width: string;
  height: string;
  weight_unit: "kg";
  weight: string;
  declared_value: string;
  num_pieces: string;
  customer_reference_number: string;
  cod_collection_mode: string;
  cod_amount: string;
  commodity_id: string;
  /** Blank: DTDC allocates the consignment number. */
  reference_number: string;
  consignment_type: "Forward";
  is_risk_surcharge_applicable: boolean;
  invoice_number: string;
  invoice_date: string;
  origin_details: DtdcParty;
  destination_details: DtdcParty;
  pieces_detail: DtdcPiece[];
}

export interface DtdcSoftdataResult {
  success?: boolean;
  reference_number?: string;
  customer_reference_number?: string;
  courier_partner?: string;
  courier_account?: string;
  message?: string;
  reason?: string;
  [k: string]: unknown;
}

export interface DtdcTracking {
  consignment: string;
  status: string;
  statusCode: string;
  statusDate: string;
  statusTime: string;
  remarks: string;
  scans: { action: string; code: string; date: string; time: string; origin: string; destination: string; remarks: string }[];
  raw: unknown;
}

export interface DtdcServiceability {
  serviceable: boolean;
  cod: boolean;
  city: string | null;
  state: string | null;
  message: string | null;
}

/** Thrown for anything the caller should show or log; carries no secret. */
export class DtdcError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "DtdcError";
    this.status = status;
    this.body = body;
  }
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
 * Their envelopes: `{"error":{"message","statusCode","reason"}}` from Shipsy,
 * `{"status":401,"error":"Unauthorized","message":…}` from the tracking
 * host, `{"data":[{"success":false,"message":…}]}` for a refused
 * consignment, and plain text ("Not Authorized") from the token endpoint.
 */
export function describeError(body: unknown): string | null {
  if (typeof body === "string") return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || null;
  if (!isRecord(body)) return null;

  if (isRecord(body.error)) {
    const e = body.error;
    const message = typeof e.message === "string" ? e.message.trim() : "";
    const reason = typeof e.reason === "string" ? e.reason.trim() : "";
    return [message, reason && reason !== message ? `(${reason})` : ""].filter(Boolean).join(" ") || "DTDC returned an error.";
  }
  if (typeof body.error === "string" && body.error.trim()) {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    return message || body.error.trim();
  }
  if (body.status === "ERROR" || body.status === "FAILED" || body.statusFlag === false) {
    const message = typeof body.message === "string" ? body.message : typeof body.errorDetails === "string" ? body.errorDetails : "";
    return message || "DTDC reported a failure.";
  }
  if (Array.isArray(body.data)) {
    const failed = body.data.filter((d): d is Record<string, unknown> => isRecord(d) && d.success === false);
    if (failed.length) {
      return failed
        .map((d) => [d.message, d.reason].filter((v): v is string => typeof v === "string" && v.trim().length > 0).join(" "))
        .filter(Boolean)
        .join(" ") || "DTDC did not accept the consignment.";
    }
  }
  return null;
}

async function shipsy<T>(config: DtdcConfig, path: string, init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" }): Promise<T> {
  const response = await fetch(`${DTDC_HOSTS[config.environment]}/${path}`, {
    method: init.method,
    headers: {
      "api-key": config.apiKey,
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const body = await readBody(response);
  const message = describeError(body);
  if (!response.ok) throw new DtdcError(message ?? `DTDC returned HTTP ${response.status}.`, response.status, body);
  if (message) throw new DtdcError(message, response.status, body);
  return body as T;
}

/* -------------------------------------------------------------------------- */
/* Tracking token cache                                                        */
/* -------------------------------------------------------------------------- */

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Their token lifetime is undocumented; a day is safe, and a 401 re-mints anyway. */
const TOKEN_TTL_MS = 12 * 60 * 60_000;

const tokens = new Map<string, CachedToken>();

export function clearDtdcTokens() {
  tokens.clear();
}

async function trackingToken(config: DtdcConfig): Promise<string> {
  // No username means the secret *is* the token, issued by DTDC directly.
  if (!config.trackingUsername) return config.trackingSecret;

  const key = `${config.environment}:${config.trackingUsername}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const params = new URLSearchParams({ username: config.trackingUsername, password: config.trackingSecret });
  const response = await fetch(`${DTDC_TRACKING_HOSTS[config.environment]}/dtdc-api/api/dtdc/authenticate?${params}`, {
    headers: { Accept: "application/json, text/plain" },
    cache: "no-store",
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new DtdcError(describeError(body) ?? `DTDC tracking rejected the credentials (HTTP ${response.status}).`, response.status, body);
  }
  // The token comes back as the bare body (text) or, on some deployments, as
  // JSON `{"token": ...}`.
  const token = typeof body === "string" ? body.trim() : isRecord(body) && typeof body.token === "string" ? body.token : "";
  if (!token) throw new DtdcError("DTDC tracking did not return an access token.", response.status, body);
  tokens.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Proves the API key works. There is no cheap read on the Shipsy side, so
 * this sends an empty softdata request: a wrong key answers 401 before any
 * validation, a right one answers with a validation error about the empty
 * list — and nothing is booked either way.
 */
export async function testDtdcConnection(config: DtdcConfig): Promise<string> {
  try {
    await shipsy(config, "customer/integration/consignment/softdata", { method: "POST", body: { consignments: [] } });
    return "API key accepted";
  } catch (cause) {
    if (cause instanceof DtdcError && cause.status === 401) throw cause;
    // Any other refusal means the key got through the door.
    return "API key accepted";
  }
}

export interface DtdcBooked {
  consignmentNo: string;
  raw: unknown;
}

export async function createDtdcConsignment(config: DtdcConfig, consignment: DtdcConsignment): Promise<DtdcBooked> {
  const body = await shipsy<{ data?: DtdcSoftdataResult[]; status?: string }>(
    config,
    "customer/integration/consignment/softdata",
    { method: "POST", body: { consignments: [consignment] } }
  );
  const first = Array.isArray(body?.data) ? body.data[0] : undefined;
  const number = first && typeof first.reference_number === "string" ? first.reference_number.trim() : "";
  if (!first || first.success === false || !number) {
    throw new DtdcError(describeError(body) ?? "DTDC accepted the request but returned no consignment number.", undefined, body);
  }
  return { consignmentNo: number, raw: body };
}

export async function cancelDtdcConsignment(config: DtdcConfig, consignmentNo: string): Promise<void> {
  const body = await shipsy<Record<string, unknown>>(config, "customer/integration/consignment/cancel", {
    method: "POST",
    body: { AWBNo: [consignmentNo], customerCode: config.customerCode },
  });
  const failures = isRecord(body) && Array.isArray(body.failure) ? body.failure : [];
  if (failures.length) {
    const reason = failures
      .map((f) => (isRecord(f) ? [f.AWBNo, f.reason ?? f.message].filter(Boolean).join(": ") : String(f)))
      .join(" ");
    throw new DtdcError(reason || "DTDC did not cancel the consignment.", undefined, body);
  }
}

/** The label PDF, streamed. */
export async function fetchDtdcLabel(config: DtdcConfig, consignmentNo: string): Promise<Uint8Array> {
  const params = new URLSearchParams({ reference_number: consignmentNo, label_code: "SHIP_LABEL_4X6", label_format: "pdf" });
  const response = await fetch(`${DTDC_HOSTS[config.environment]}/customer/integration/consignment/shippinglabel/stream?${params}`, {
    headers: { "api-key": config.apiKey, Accept: "application/pdf, application/json" },
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (response.ok && /pdf|octet-stream/i.test(contentType)) return new Uint8Array(await response.arrayBuffer());

  const body = await readBody(response);
  const message = describeError(body);
  if (!response.ok) throw new DtdcError(message ?? `DTDC returned HTTP ${response.status}.`, response.status, body);
  if (message) throw new DtdcError(message, response.status, body);

  // Some deployments wrap the PDF as base64 in JSON.
  const base64 = isRecord(body) && typeof body.data === "string" ? body.data : typeof body === "string" ? body : "";
  if (!base64) throw new DtdcError("DTDC returned no label content.", response.status, body);
  return new Uint8Array(Buffer.from(base64.replace(/^data:application\/pdf;base64,/, ""), "base64"));
}

/**
 * Status and scans from DTDC's tracking API. Field names are theirs
 * (`trackHeader.strStatus`, `trackDetails[].strAction`); anything absent
 * reads as blank rather than failing, since the shape has never been
 * observed on this account.
 */
export async function trackDtdc(config: DtdcConfig, consignmentNo: string, isRetry = false): Promise<DtdcTracking | null> {
  if (!config.trackingSecret) {
    throw new DtdcError("DTDC tracking needs the tracking username and password (or access token) in Settings → Shipping.");
  }
  const token = await trackingToken(config);
  const response = await fetch(`${DTDC_TRACKING_HOSTS[config.environment]}/dtdc-api/rest/JSONCnTrk/getTrackDetails`, {
    method: "POST",
    headers: { "X-Access-Token": token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ trkType: "cnno", strcnno: consignmentNo, addtnlDtl: "Y" }),
    cache: "no-store",
  });
  const body = await readBody(response);

  // A token that expired on their side reads as 401. Re-mint once, for
  // username accounts only — a static token cannot be refreshed here.
  if (response.status === 401 && config.trackingUsername && !isRetry) {
    tokens.delete(`${config.environment}:${config.trackingUsername}`);
    return trackDtdc(config, consignmentNo, true);
  }

  const message = describeError(body);
  if (!response.ok) throw new DtdcError(message ?? `DTDC tracking returned HTTP ${response.status}.`, response.status, body);
  if (message) throw new DtdcError(message, response.status, body);
  return parseDtdcTracking(body, consignmentNo);
}

export function parseDtdcTracking(body: unknown, consignmentNo: string): DtdcTracking | null {
  if (!isRecord(body)) return null;
  const header = isRecord(body.trackHeader) ? body.trackHeader : null;
  const details = Array.isArray(body.trackDetails) ? body.trackDetails.filter(isRecord) : [];
  if (!header && !details.length) return null;

  const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
  const scans = details.map((d) => ({
    action: text(d.strAction),
    code: text(d.strCode),
    date: text(d.strActionDate),
    time: text(d.strActionTime),
    origin: text(d.strOrigin),
    destination: text(d.strDestination),
    remarks: text(d.sTrRemarks ?? d.strRemarks),
  }));
  const last = scans[scans.length - 1];

  return {
    consignment: text(header?.strShipmentNo ?? header?.strCNNo) || consignmentNo,
    status: text(header?.strStatus) || last?.action || "",
    statusCode: text(header?.strStatusRelCode ?? header?.strStatusCode) || last?.code || "",
    statusDate: text(header?.strStatusTransOn) || last?.date || "",
    statusTime: text(header?.strStatusTransTime) || last?.time || "",
    remarks: text(header?.strRemarks) || last?.remarks || "",
    scans,
    raw: body,
  };
}

/**
 * Whether DTDC serves a route. Public, unauthenticated, HTTP-only — verified
 * live: `SERV_LIST[0].b2C_SERVICEABLE` / `b2C_COD_Serviceable` say YES or NO,
 * and `ZIPCODE_RESP[0].MESSAGE` is "SUCCESS" or the reason ("DESTPIN is not
 * valid").
 */
export async function checkDtdcServiceability(origin: string, destination: string): Promise<DtdcServiceability> {
  const response = await fetch(DTDC_PINCODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ orgPincode: origin, desPincode: destination }),
    cache: "no-store",
  });
  const body = await readBody(response);
  if (!response.ok || !isRecord(body)) {
    throw new DtdcError(describeError(body) ?? `DTDC pincode lookup returned HTTP ${response.status}.`, response.status, body);
  }
  const zip = Array.isArray(body.ZIPCODE_RESP) && isRecord(body.ZIPCODE_RESP[0]) ? body.ZIPCODE_RESP[0] : {};
  const serv = Array.isArray(body.SERV_LIST) && isRecord(body.SERV_LIST[0]) ? body.SERV_LIST[0] : {};
  const yes = (v: unknown) => typeof v === "string" && /^(y|yes)$/i.test(v.trim());
  const message = typeof zip.MESSAGE === "string" ? zip.MESSAGE : null;
  const ok = message === "SUCCESS";
  return {
    serviceable: ok && (yes(serv.b2C_SERVICEABLE) || yes(zip.SERVFLAG)),
    cod: ok && (yes(serv.b2C_COD_Serviceable) || yes(zip.SERV_COD)),
    city: typeof zip.DESTCITY === "string" ? zip.DESTCITY : null,
    state: typeof zip.DESTSTATE === "string" ? zip.DESTSTATE : null,
    message: ok ? null : message,
  };
}
