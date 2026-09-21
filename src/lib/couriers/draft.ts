import { nationalPhoneDigits } from "@/lib/shop/phone-codes";
import type { Order, OrderItem } from "@/lib/types";

/**
 * From an order to a parcel the courier will accept — before anyone clicks.
 *
 * The whole point of "Ship now" is that the operator does not retype anything,
 * so this module does the retyping: the consignee from the shipping address,
 * the amount to collect from the payment state, the parcel from the store's
 * defaults. It also does the checking, and it does all of it at once — a
 * pincode that is not six digits, a phone the courier cannot ring, a pickup
 * address nobody has entered yet — so the dialog can list every problem in one
 * go rather than fail on the first one after the button is pressed.
 *
 * Pure, and shared by two callers that must agree: the order page builds the
 * draft to show it, and the booking action builds it again from the database
 * to send it. The browser is never trusted for an address or an amount; it
 * only gets to say which courier, which service, and how heavy the box is.
 */

/** One side of a shipment: who, where, how to reach them. */
export interface ShipmentParty {
  name: string;
  phone: string;
  email: string;
  address1: string;
  address2: string;
  landmark: string;
  city: string;
  state: string;
  /** Six digits for India; validated as such because both couriers are domestic. */
  postal_code: string;
  /** ISO 3166-1 alpha-2, as checkout stores it. */
  country: string;
  gst_number: string;
}

/** What `courier_settings.pickup` holds. Same shape, plus a company name. */
export interface PickupAddress extends ShipmentParty {
  company: string;
}

export interface PackageDefaults {
  weight_kg: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
}

export interface CourierSettings {
  pickup: PickupAddress | null;
  /** Null means "same as pickup", which is what the dialog shows. */
  returnAddress: PickupAddress | null;
  packageDefaults: PackageDefaults;
}

export const DEFAULT_PACKAGE: PackageDefaults = {
  // A folded garment in a poly mailer. Round enough that nobody mistakes it
  // for a measurement; the settings page is where the real numbers go.
  weight_kg: 0.5,
  length_cm: 30,
  width_cm: 25,
  height_cm: 5,
};

/** The fields the operator may change in the dialog. Everything else is derived. */
export interface PackageInput {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  pieces: number;
}

export interface DraftItem {
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
}

export interface ShipmentDraft {
  orderId: string;
  orderNumber: number;
  currency: string;
  consignee: ShipmentParty;
  pickup: PickupAddress | null;
  returnTo: PickupAddress | null;
  paymentMode: "prepaid" | "cod";
  /** What the courier collects at the door. Zero for prepaid. */
  collectableAmount: number;
  /** The parcel's value for the courier's records and insurance. */
  declaredValue: number;
  items: DraftItem[];
  itemCount: number;
  pkg: PackageInput;
  /** Reasons this cannot be booked as it stands. Empty means go. */
  problems: string[];
  /** Worth a look, not a blocker. */
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* Parsing what the database holds                                             */
/* -------------------------------------------------------------------------- */

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const num = (v: unknown, fallback: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** A stored address blob, or null when nothing useful has been entered. */
export function parsePickupAddress(value: unknown): PickupAddress | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  const address: PickupAddress = {
    name: str(a.name),
    company: str(a.company),
    phone: str(a.phone),
    email: str(a.email),
    address1: str(a.address1),
    address2: str(a.address2),
    landmark: str(a.landmark),
    city: str(a.city),
    state: str(a.state),
    postal_code: str(a.postal_code),
    country: (str(a.country) || "IN").toUpperCase(),
    gst_number: str(a.gst_number),
  };
  // "Entered" means at least a street and a pincode. A row created by saving
  // the package defaults alone must not read as an address.
  return address.address1 || address.postal_code ? address : null;
}

export function parsePackageDefaults(value: unknown): PackageDefaults {
  const a = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    weight_kg: num(a.weight_kg, DEFAULT_PACKAGE.weight_kg),
    length_cm: num(a.length_cm, DEFAULT_PACKAGE.length_cm),
    width_cm: num(a.width_cm, DEFAULT_PACKAGE.width_cm),
    height_cm: num(a.height_cm, DEFAULT_PACKAGE.height_cm),
  };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

const PINCODE = /^[1-9]\d{5}$/;

export function isValidPincode(value: string): boolean {
  return PINCODE.test(value.trim());
}

/** A phone the courier can ring: ten national digits. */
export function isValidIndianMobile(value: string): boolean {
  return /^[6-9]\d{9}$/.test(nationalPhoneDigits(value));
}

/**
 * Checks an address the way both couriers will. Returns the reasons it fails,
 * prefixed with whose address it is so the list in the dialog reads as
 * instructions.
 */
export function addressProblems(party: ShipmentParty | null, whose: string): string[] {
  if (!party) return [`No ${whose} address has been set up yet.`];
  const problems: string[] = [];
  if (!party.name) problems.push(`The ${whose} address needs a contact name.`);
  if (!party.address1) problems.push(`The ${whose} address needs a street address.`);
  if (!party.city) problems.push(`The ${whose} address needs a city.`);
  if (!party.state) problems.push(`The ${whose} address needs a state.`);
  if (!isValidPincode(party.postal_code)) {
    problems.push(`The ${whose} pincode “${party.postal_code || "—"}” is not a valid 6-digit Indian pincode.`);
  }
  if (!isValidIndianMobile(party.phone)) {
    problems.push(`The ${whose} phone number “${party.phone || "—"}” is not a 10-digit Indian mobile number.`);
  }
  if (party.country && party.country.toUpperCase() !== "IN") {
    problems.push(`The ${whose} address is outside India (${party.country}); both couriers are domestic only.`);
  }
  return problems;
}

/**
 * Bounds on what the dialog may send. Not the couriers' own limits — those are
 * per-contract — but the range outside which the number is a typo: nobody
 * ships a 0.001 kg parcel or a 3-metre box from this store.
 */
export const PACKAGE_LIMITS = {
  weightKg: { min: 0.05, max: 50 },
  dimensionCm: { min: 1, max: 200 },
  pieces: { min: 1, max: 20 },
} as const;

export function packageProblems(pkg: PackageInput): string[] {
  const problems: string[] = [];
  const { weightKg, dimensionCm, pieces } = PACKAGE_LIMITS;
  if (!Number.isFinite(pkg.weightKg) || pkg.weightKg < weightKg.min || pkg.weightKg > weightKg.max) {
    problems.push(`Weight must be between ${weightKg.min} and ${weightKg.max} kg.`);
  }
  for (const [label, value] of [
    ["Length", pkg.lengthCm],
    ["Width", pkg.widthCm],
    ["Height", pkg.heightCm],
  ] as const) {
    if (!Number.isFinite(value) || value < dimensionCm.min || value > dimensionCm.max) {
      problems.push(`${label} must be between ${dimensionCm.min} and ${dimensionCm.max} cm.`);
    }
  }
  if (!Number.isInteger(pkg.pieces) || pkg.pieces < pieces.min || pkg.pieces > pieces.max) {
    problems.push(`Pieces must be a whole number between ${pieces.min} and ${pieces.max}.`);
  }
  return problems;
}

/** Both couriers divide by 5000 for domestic volumetric weight. */
export function volumetricWeightKg(pkg: Pick<PackageInput, "lengthCm" | "widthCm" | "heightCm">): number {
  const v = (pkg.lengthCm * pkg.widthCm * pkg.heightCm) / 5000;
  return Math.round(v * 1000) / 1000;
}

/* -------------------------------------------------------------------------- */
/* Building                                                                    */
/* -------------------------------------------------------------------------- */

/** The consignee, straight from the order — never from the browser. */
export function consigneeFromOrder(order: Order): ShipmentParty {
  const a = order.shipping_address ?? {};
  return {
    name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim(),
    // The order's phone is what checkout verified; the address blob's copy is
    // whatever was typed into the address form and may be blank.
    phone: nationalPhoneDigits(order.phone || a.phone || ""),
    email: (order.email ?? "").trim(),
    address1: (a.address1 ?? "").trim(),
    address2: (a.address2 ?? "").trim(),
    landmark: "",
    city: (a.city ?? "").trim(),
    state: (a.province ?? "").trim(),
    postal_code: (a.postal_code ?? "").trim(),
    country: (a.country ?? "IN").trim().toUpperCase() || "IN",
    gst_number: "",
  };
}

/**
 * Builds the draft, or the list of reasons it cannot be booked.
 *
 * `pkg` is the operator's override from the dialog; without one the store's
 * defaults are used, which is what the dialog opens with. Money follows the
 * same rule as the Qikink mapping: an order that is not fully paid is
 * collected on delivery, and for a partial-COD order that is the *balance* —
 * the advance in `amount_paid` (0033) has already been captured online, so the
 * courier must ask for `total - amount_paid`, never the total.
 */
export function buildShipmentDraft(input: {
  order: Order;
  items: OrderItem[];
  /** SKU per item id, from the catalogue; missing ones fall back to the title. */
  skus?: Map<string, string>;
  settings: CourierSettings;
  pkg?: Partial<PackageInput> | null;
}): ShipmentDraft {
  const { order, items, settings } = input;
  const problems: string[] = [];
  const warnings: string[] = [];

  const consignee = consigneeFromOrder(order);
  const pickup = settings.pickup;
  const returnTo = settings.returnAddress ?? settings.pickup;

  if (order.is_draft) problems.push("This is a draft order. Convert it to an order before shipping.");
  if (order.cancelled_at) problems.push("This order is cancelled.");
  if (order.fulfillment_status === "fulfilled") {
    problems.push("This order is already marked fulfilled.");
  }
  if (order.held_at && !order.released_at) {
    // Not blocking: pressing Ship *is* the decision, and the action releases
    // the hold (see ship-actions.ts). But the operator should know that is
    // what they are doing.
    warnings.push("This order is held for COD review. Shipping it releases the hold and withdraws any advance request still open.");
  }

  if (!items.length) problems.push("Order has no line items.");

  problems.push(...addressProblems(consignee, "customer's shipping"));
  problems.push(...addressProblems(pickup, "pickup"));
  if (settings.returnAddress) problems.push(...addressProblems(settings.returnAddress, "return"));

  const total = Number(order.total) || 0;
  const paid = Number(order.amount_paid ?? 0) || 0;
  const fullyPaid = order.payment_status === "paid" || order.payment_status === "partially_refunded";
  const paymentMode: "prepaid" | "cod" = fullyPaid ? "prepaid" : "cod";
  const collectableAmount = paymentMode === "cod" ? Math.max(0, round2(total - paid)) : 0;

  if (paymentMode === "cod" && order.payment_method && order.payment_method !== "cod") {
    warnings.push(
      `Payment is still ${order.payment_status.replaceAll("_", " ")} on this ${order.payment_method} order, so it will be booked as COD for the balance.`
    );
  }
  if (order.payment_status === "voided" || order.payment_status === "refunded") {
    problems.push(`Payment on this order is ${order.payment_status}.`);
  }

  const defaults = settings.packageDefaults;
  const pkg: PackageInput = {
    weightKg: pick(input.pkg?.weightKg, defaults.weight_kg),
    lengthCm: pick(input.pkg?.lengthCm, defaults.length_cm),
    widthCm: pick(input.pkg?.widthCm, defaults.width_cm),
    heightCm: pick(input.pkg?.heightCm, defaults.height_cm),
    pieces: Math.trunc(pick(input.pkg?.pieces, 1)),
  };
  problems.push(...packageProblems(pkg));

  const draftItems: DraftItem[] = items.map((item) => ({
    name: [item.title_snapshot, item.variant_snapshot].filter(Boolean).join(" — "),
    sku: input.skus?.get(item.id) || fallbackSku(item),
    quantity: item.quantity,
    unitPrice: round2(Number(item.price_snapshot) || 0),
  }));

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    currency: order.currency,
    consignee,
    pickup,
    returnTo,
    paymentMode,
    collectableAmount,
    // The goods' value, not the collectable: a prepaid parcel is still worth
    // what was paid for it if it goes missing.
    declaredValue: round2(Math.max(total, 0)),
    items: draftItems,
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    pkg,
    problems: dedupe(problems),
    warnings: dedupe(warnings),
  };
}

function pick(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/**
 * Both couriers want *a* SKU per item and neither does anything with it beyond
 * printing it. A catalogue SKU is used when there is one; otherwise something
 * stable and recognisable, since an empty string is refused.
 */
function fallbackSku(item: OrderItem): string {
  const base = item.variant_id ?? item.product_id ?? item.id;
  return `HZ-${base.slice(0, 8).toUpperCase()}`;
}

/** A one-line description of the contents, for the courier's "commodity" field. */
export function describeContents(items: DraftItem[], max = 30): string {
  const text = items.length === 1 ? items[0].name : `Apparel (${items.length} items)`;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text || "Apparel";
}
