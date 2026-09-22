import type { CourierEnvironment, DelhiveryConfig } from "../config";

/**
 * Delhivery's B2C (Express) API.
 *
 * Reference: https://one.delhivery.com/developer-portal/documents — the
 * current "Delhivery One" portal; the older readme.io site says the same
 * things with older examples. The surface this store uses:
 *
 *   POST /api/cmu/create.json                 manifest a package → waybill
 *   POST /api/p/edit                          cancel before pickup
 *   GET  /api/v1/packages/json/?waybill=      status + scans
 *   GET  /api/p/packing_slip?wbns=&pdf=true   label PDF (an S3 link)
 *   GET  /c/api/pin-codes/json/?filter_codes= is the pincode serviceable
 *   POST /fm/request/new/                     ask for a pickup
 *
 * One credential: `Authorization: Token <api token>` on everything. Two
 * things about the manifest call are load-bearing and easy to get wrong:
 *
 *   1. The body is `format=json&data=<json>`, and their raw-body parser
 *      chokes on `& # % ; \\` inside the JSON. Sent as a real form post
 *      (application/x-www-form-urlencoded, properly encoded) instead, which
 *      is what their own portal advises — "use URL-encoded payloads" — and
 *      was confirmed live: both hosts parse it and go on to check the token.
 *   2. The pickup location is a warehouse *name* registered on the account,
 *      matched exactly, case and spaces included.
 *
 * Failure arrives in several dresses: `{"detail": "..."}` for auth, an HTML
 * "Login or API Key Required" page, `{"rmk": "...", "success": false}` from
 * the manifest endpoint (with per-package `remarks`), and XML from `/api/p/edit`
 * unless JSON is asked for. `describeError` reads all of them.
 */

export const DELHIVERY_HOSTS: Record<CourierEnvironment, string> = {
  sandbox: "https://staging-express.delhivery.com",
  live: "https://track.delhivery.com",
};

export interface DlvShipment {
  name: string;
  add: string;
  pin: string;
  city: string;
  state: string;
  country: string;
  phone: string;
  order: string;
  payment_mode: "COD" | "Prepaid";
  return_pin: string;
  return_city: string;
  return_phone: string;
  return_add: string;
  return_state: string;
  return_country: string;
  return_name: string;
  products_desc: string;
  hsn_code: string;
  cod_amount: string;
  order_date: string | null;
  total_amount: string;
  seller_add: string;
  seller_name: string;
  seller_inv: string;
  seller_gst_tin: string;
  quantity: string;
  waybill: string;
  shipment_width: string;
  shipment_height: string;
  shipment_length: string;
  /** Grams. */
  weight: string;
  shipping_mode: "Surface" | "Express";
  address_type: string;
  fragile_shipment?: boolean;
}

export interface DlvManifest {
  shipments: DlvShipment[];
  pickup_location: { name: string };
}

export interface DlvPackageResult {
  status?: string;
  waybill?: string;
  refnum?: string;
  sort_code?: string | null;
  client?: string;
  cod_amount?: number | string;
  payment?: string;
  serviceable?: boolean;
  remarks?: string[] | string;
}

export interface DlvManifestResponse {
  success?: boolean;
  error?: boolean;
  rmk?: string | null;
  upload_wbn?: string | null;
  package_count?: number;
  packages?: DlvPackageResult[];
  [k: string]: unknown;
}

export interface DlvScan {
  scan: string;
  scanType: string;
  dateTime: string;
  location: string;
  instructions: string;
}

export interface DlvTracking {
  waybill: string;
  status: string;
  statusType: string;
  statusDateTime: string;
  statusLocation: string;
  instructions: string;
  scans: DlvScan[];
  raw: unknown;
}

export interface DlvServiceability {
  serviceable: boolean;
  cod: boolean;
  prepaid: boolean;
  district: string | null;
  stateCode: string | null;
  remark: string | null;
}

/** Thrown for anything the caller should show or log; carries no secret. */
export class DelhiveryError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "DelhiveryError";
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

/** An HTML or XML error page as one line: "Login or API Key Required", "Invalid token". */
function flatten(text: string): string | null {
  const flat = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return flat.slice(0, 300) || null;
}

/**
 * The sentence for a failure, or null when nothing in the body says failure.
 * The manifest endpoint's `success:false` with `rmk` is the important one:
 * "Package creation API error … 'NoneType' object has no attribute 'end_date'"
 * is what their staging returned to a malformed request, and the operator
 * needs that sentence, not "HTTP 200".
 */
export function describeError(body: unknown): string | null {
  if (typeof body === "string") return flatten(body);
  if (!isRecord(body)) return null;

  if (typeof body.detail === "string" && body.detail.trim()) return body.detail.trim();
  if (typeof body.error === "string" && body.error.trim()) return body.error.trim();

  if (body.success === false || body.error === true) {
    const remarks = packageRemarks(body.packages);
    const rmk = typeof body.rmk === "string" ? body.rmk.trim() : "";
    return [rmk, remarks].filter(Boolean).join(" ") || "Delhivery refused the request without a message.";
  }
  if (typeof body.status === "string" && /fail/i.test(body.status)) {
    const remarks = packageRemarks([body]) || (typeof body.remark === "string" ? body.remark : "");
    return remarks || "Delhivery reported a failure.";
  }
  return null;
}

function packageRemarks(packages: unknown): string {
  if (!Array.isArray(packages)) return "";
  const lines: string[] = [];
  for (const p of packages) {
    if (!isRecord(p)) continue;
    const remarks = p.remarks;
    if (Array.isArray(remarks)) lines.push(...remarks.filter((r): r is string => typeof r === "string" && r.trim().length > 0));
    else if (typeof remarks === "string" && remarks.trim()) lines.push(remarks.trim());
  }
  return lines.join(" ");
}

function headers(config: DelhiveryConfig, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Token ${config.token}`, Accept: "application/json", ...extra };
}

async function request<T>(
  config: DelhiveryConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: string; contentType?: string } = { method: "GET" }
): Promise<T> {
  const response = await fetch(`${DELHIVERY_HOSTS[config.environment]}${path}`, {
    method: init.method,
    headers: headers(config, init.contentType ? { "Content-Type": init.contentType } : {}),
    body: init.body,
    cache: "no-store",
  });
  const body = await readBody(response);
  const message = describeError(body);
  if (response.status === 401 || response.status === 403) {
    throw new DelhiveryError(message ?? "Delhivery rejected the API token.", response.status, body);
  }
  if (!response.ok) throw new DelhiveryError(message ?? `Delhivery returned HTTP ${response.status}.`, response.status, body);
  if (message) throw new DelhiveryError(message, response.status, body);
  return body as T;
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Proves the token works without booking anything: a pincode lookup, the
 * cheapest authenticated call they have. A bad token answers 401 "Login or
 * API Key Required".
 */
export async function testDelhiveryConnection(config: DelhiveryConfig): Promise<string> {
  const result = await checkDelhiveryPincode(config, "110001");
  return result.serviceable ? "Token accepted" : "Token accepted (test pincode reported unserviceable)";
}

export interface DlvBooked {
  waybill: string;
  refnum: string | null;
  sortCode: string | null;
  raw: DlvManifestResponse;
}

export async function createDelhiveryShipment(config: DelhiveryConfig, manifest: DlvManifest): Promise<DlvBooked> {
  const form = new URLSearchParams({ format: "json", data: JSON.stringify(manifest) });
  const body = await request<DlvManifestResponse>(config, "/api/cmu/create.json", {
    method: "POST",
    body: form.toString(),
    contentType: "application/x-www-form-urlencoded",
  });

  const packages = Array.isArray(body?.packages) ? body.packages : [];
  const first = packages[0];
  const waybill = first && typeof first.waybill === "string" ? first.waybill.trim() : "";
  const failed = !first || /fail|error/i.test(String(first.status ?? "")) || !waybill;
  if (failed) {
    const remarks = packageRemarks(packages);
    const rmk = typeof body?.rmk === "string" ? body.rmk.trim() : "";
    throw new DelhiveryError(
      [rmk, remarks].filter(Boolean).join(" ") || "Delhivery accepted the request but returned no waybill.",
      undefined,
      body
    );
  }
  return {
    waybill,
    refnum: typeof first.refnum === "string" ? first.refnum : null,
    sortCode: typeof first.sort_code === "string" ? first.sort_code : null,
    raw: body,
  };
}

/**
 * Cancels before pickup. Their docs: a manifested package stays "Manifested"
 * (UD) after cancellation; one already moving becomes a return (RT) — which
 * is why the caller only offers this while the stage is still `booked`.
 */
export async function cancelDelhiveryShipment(config: DelhiveryConfig, waybill: string): Promise<void> {
  const body = await request<Record<string, unknown>>(config, "/api/p/edit", {
    method: "POST",
    body: JSON.stringify({ waybill, cancellation: "true" }),
    contentType: "application/json",
  });
  if (isRecord(body) && body.status === false) {
    throw new DelhiveryError(
      (typeof body.remark === "string" && body.remark) || "Delhivery did not cancel the shipment.",
      undefined,
      body
    );
  }
}

/**
 * Status and scans. Their JSON mirrors the XML it grew from: `ShipmentData[]
 * → Shipment → Status{Status, StatusType, StatusDateTime, StatusLocation,
 * Instructions}` and `Scans[] → ScanDetail{...}`.
 */
export async function trackDelhivery(config: DelhiveryConfig, waybill: string): Promise<DlvTracking | null> {
  const body = await request<unknown>(
    config,
    `/api/v1/packages/json/?waybill=${encodeURIComponent(waybill)}&ref_ids=`
  );
  return parseDelhiveryTracking(body, waybill);
}

export function parseDelhiveryTracking(body: unknown, waybill: string): DlvTracking | null {
  if (!isRecord(body)) return null;
  const data = Array.isArray(body.ShipmentData) ? body.ShipmentData : [];
  const first = data.find(isRecord);
  const shipment = first && isRecord(first.Shipment) ? first.Shipment : null;
  if (!shipment) return null;

  const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
  const status = isRecord(shipment.Status) ? shipment.Status : {};

  const scans: DlvScan[] = (Array.isArray(shipment.Scans) ? shipment.Scans : [])
    .map((s) => (isRecord(s) && isRecord(s.ScanDetail) ? s.ScanDetail : null))
    .filter((s): s is Record<string, unknown> => Boolean(s))
    .map((d) => ({
      scan: text(d.Scan),
      scanType: text(d.ScanType),
      dateTime: text(d.ScanDateTime ?? d.StatusDateTime),
      location: text(d.ScannedLocation),
      instructions: text(d.Instructions),
    }));

  const current = text(status.Status);
  if (!current && !scans.length) return null;

  return {
    waybill: text(shipment.AWB) || waybill,
    status: current,
    statusType: text(status.StatusType),
    statusDateTime: text(status.StatusDateTime),
    statusLocation: text(status.StatusLocation),
    instructions: text(status.Instructions),
    scans,
    raw: body,
  };
}

/**
 * The label. With `pdf=true` their answer is JSON carrying an S3 link to the
 * PDF (per their docs, "an S3 link of the pdf will be generated"); some
 * accounts stream the PDF itself. Both are handled, and the link is fetched
 * so the caller only ever sees bytes.
 */
export async function fetchDelhiveryLabel(config: DelhiveryConfig, waybill: string): Promise<Uint8Array> {
  const response = await fetch(
    `${DELHIVERY_HOSTS[config.environment]}/api/p/packing_slip?wbns=${encodeURIComponent(waybill)}&pdf=true&pdf_size=4R`,
    { headers: headers(config, { Accept: "application/pdf, application/json" }), cache: "no-store" }
  );
  const contentType = response.headers.get("content-type") ?? "";
  if (response.ok && /pdf|octet-stream/i.test(contentType)) return new Uint8Array(await response.arrayBuffer());

  const body = await readBody(response);
  const message = describeError(body);
  if (!response.ok) throw new DelhiveryError(message ?? `Delhivery returned HTTP ${response.status}.`, response.status, body);
  if (message) throw new DelhiveryError(message, response.status, body);

  const link = findPdfLink(body);
  if (!link) throw new DelhiveryError("Delhivery returned no label for this waybill yet. Try again in a minute.", response.status, body);

  const pdf = await fetch(link, { cache: "no-store" });
  if (!pdf.ok) throw new DelhiveryError(`Could not download the label (HTTP ${pdf.status}).`, pdf.status);
  return new Uint8Array(await pdf.arrayBuffer());
}

/** The first https link to a PDF anywhere in their response. */
export function findPdfLink(body: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (value: unknown): string | null => {
    if (typeof value === "string") {
      return /^https?:\/\/\S+/.test(value) && (/\.pdf(\?|$)/i.test(value) || /pdf/i.test(value)) ? value : null;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    for (const entry of entries) {
      const found = walk(entry);
      if (found) return found;
    }
    return null;
  };
  return walk(body);
}

/**
 * Whether Delhivery delivers to a pincode, and for which payment modes. An
 * empty `delivery_codes` list means not serviceable; a "remark" of "Embargo"
 * means temporarily not.
 */
export async function checkDelhiveryPincode(config: DelhiveryConfig, pincode: string): Promise<DlvServiceability> {
  const body = await request<{ delivery_codes?: { postal_code?: Record<string, unknown> }[] }>(
    config,
    `/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`
  );
  const codes = Array.isArray(body?.delivery_codes) ? body.delivery_codes : [];
  const entry = codes.find((c) => isRecord(c) && isRecord(c.postal_code))?.postal_code ?? null;
  if (!entry) return { serviceable: false, cod: false, prepaid: false, district: null, stateCode: null, remark: null };

  const yes = (v: unknown) => typeof v === "string" && v.trim().toUpperCase() === "Y";
  const remark = typeof entry.remark === "string" && entry.remark.trim() ? entry.remark.trim() : null;
  return {
    serviceable: !remark || !/embargo/i.test(remark),
    cod: yes(entry.cod),
    prepaid: yes(entry.pre_paid),
    district: typeof entry.district === "string" ? entry.district : null,
    stateCode: typeof entry.state_code === "string" ? entry.state_code : null,
    remark,
  };
}

/** Asks for a pickup from the registered warehouse. Optional; many accounts have a standing daily pickup. */
export async function requestDelhiveryPickup(
  config: DelhiveryConfig,
  input: { date: string; time: string; expectedPackages: number }
): Promise<void> {
  await request(config, "/fm/request/new/", {
    method: "POST",
    body: JSON.stringify({
      pickup_time: input.time,
      pickup_date: input.date,
      pickup_location: config.pickupLocation,
      expected_package_count: input.expectedPackages,
    }),
    contentType: "application/json",
  });
}
