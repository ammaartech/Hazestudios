import { describeContents, type ShipmentDraft } from "../draft";
import type { DlvManifest, DlvShipment } from "./client";

/**
 * A shipment draft as a Delhivery manifest.
 *
 * Their sample payload (developer portal → Shipment Creation) is the
 * template, and their own advice is followed: "include all fields mentioned
 * in the sample payload, even if they are not mandatory". So every key is
 * present, blank where we have nothing, because their parser has been seen
 * to prefer a known key with an empty value to a missing one.
 *
 * Three units differ from every other courier here: weight is **grams**,
 * `order_date` is `YYYY-MM-DD HH:MM:SS`, and money is a plain decimal string.
 * The order id is our order number, which must be unique per manifest on
 * their side — a re-booking after a cancellation therefore gets a suffix.
 */

export interface DelhiveryBookingOptions {
  service: "Surface" | "Express";
  /** The registered warehouse name, verbatim. */
  pickupLocation: string;
  sellerName: string;
  sellerAddress: string;
  sellerGstin: string;
  /** 1 for the first booking of this order with Delhivery, 2 for the next… */
  attempt: number;
  now?: Date;
  note?: string;
}

/** Their `order` must be unique per account; a re-booking gets a distinct id. */
export function delhiveryOrderId(orderNumber: number, attempt: number): string {
  return attempt > 1 ? `${orderNumber}-R${attempt}` : String(orderNumber);
}

/** `YYYY-MM-DD HH:MM:SS` in IST, which is the clock their dashboard shows. */
export function delhiveryDate(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())} ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}`;
}

/**
 * Their raw-body parser cannot take `& # % ; \` even though the request goes
 * up URL-encoded now; a name or street with an ampersand in it is common
 * enough ("Sons & Co") that the characters are replaced rather than risking
 * a refusal. `&` becomes "and", the rest become spaces.
 */
export function safeText(text: string): string {
  return text.replace(/&/g, " and ").replace(/[#%;\\]/g, " ").replace(/\s+/g, " ").trim();
}

export function mapDraftToDelhivery(draft: ShipmentDraft, options: DelhiveryBookingOptions): DlvManifest {
  if (!draft.pickup) throw new Error("A pickup address is required to build a Delhivery manifest.");
  const returnTo = draft.returnTo ?? draft.pickup;
  const cod = draft.paymentMode === "cod";
  const money = (n: number) => n.toFixed(2);

  const shipment: DlvShipment = {
    name: safeText(draft.consignee.name),
    add: safeText([draft.consignee.address1, draft.consignee.address2, draft.consignee.landmark].filter(Boolean).join(", ")),
    pin: draft.consignee.postal_code,
    city: safeText(draft.consignee.city),
    state: safeText(draft.consignee.state),
    country: "India",
    phone: draft.consignee.phone,
    order: delhiveryOrderId(draft.orderNumber, options.attempt),
    payment_mode: cod ? "COD" : "Prepaid",
    return_pin: returnTo.postal_code,
    return_city: safeText(returnTo.city),
    return_phone: returnTo.phone,
    return_add: safeText([returnTo.address1, returnTo.address2, returnTo.landmark].filter(Boolean).join(", ")),
    return_state: safeText(returnTo.state),
    return_country: "India",
    return_name: safeText(returnTo.company || returnTo.name),
    products_desc: safeText(describeContents(draft.items, 60)),
    // Apparel's HSN chapter. Their manifest asks for one; the exact heading
    // (6109, 6110…) varies by garment and only matters for an e-waybill,
    // which a sub-₹50,000 parcel never needs.
    hsn_code: "61",
    cod_amount: cod ? money(draft.collectableAmount) : "0",
    order_date: delhiveryDate(options.now ?? new Date()),
    total_amount: money(draft.declaredValue),
    seller_add: safeText(options.sellerAddress),
    seller_name: safeText(options.sellerName),
    seller_inv: `HZ${draft.orderNumber}`,
    seller_gst_tin: options.sellerGstin,
    quantity: String(draft.itemCount),
    // Blank: Delhivery assigns one from the account's pool.
    waybill: "",
    shipment_width: String(draft.pkg.widthCm),
    shipment_height: String(draft.pkg.heightCm),
    shipment_length: String(draft.pkg.lengthCm),
    weight: String(Math.round(draft.pkg.weightKg * 1000)),
    shipping_mode: options.service,
    address_type: "home",
  };

  return {
    shipments: [shipment],
    pickup_location: { name: options.pickupLocation },
  };
}
