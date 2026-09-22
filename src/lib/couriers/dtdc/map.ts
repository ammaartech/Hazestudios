import { describeContents, type ShipmentDraft, type ShipmentParty } from "../draft";
import type { DtdcConsignment, DtdcParty } from "./client";

/**
 * A shipment draft as a DTDC consignment ("softdata").
 *
 * DTDC's platform takes numbers as strings, weight in kilograms, dimensions
 * in centimetres, and wants every piece listed with its own value and weight
 * even for a single-box parcel. `customer_reference_number` is our order
 * number and is what appears on their portal; `reference_number` is *their*
 * consignment number and is sent blank so they allocate one.
 */

export interface DtdcBookingOptions {
  service: string;
  customerCode: string;
  commodityId: string;
  /** "cash" unless the account says otherwise. Sent blank for prepaid. */
  codCollectionMode: string;
  /** 1 for the first booking of this order with DTDC, 2 for the next… */
  attempt: number;
  now?: Date;
}

function party(p: ShipmentParty, company?: string): DtdcParty {
  return {
    name: (company || p.name).slice(0, 100),
    phone: p.phone,
    alternate_phone: "",
    address_line_1: p.address1.slice(0, 200),
    address_line_2: [p.address2, p.landmark].filter(Boolean).join(", ").slice(0, 200),
    pincode: p.postal_code,
    city: p.city,
    state: p.state,
  };
}

/** Their reference must be unique per account; a re-booking gets a suffix. */
export function dtdcReference(orderNumber: number, attempt: number): string {
  return attempt > 1 ? `HZ${orderNumber}R${attempt}` : `HZ${orderNumber}`;
}

function isoDate(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

export function mapDraftToDtdc(draft: ShipmentDraft, options: DtdcBookingOptions): DtdcConsignment {
  if (!draft.pickup) throw new Error("A pickup address is required to build a DTDC consignment.");
  const cod = draft.paymentMode === "cod";
  const money = (n: number) => n.toFixed(2);
  const now = options.now ?? new Date();

  return {
    customer_code: options.customerCode,
    service_type_id: options.service,
    load_type: "NON-DOCUMENT",
    description: describeContents(draft.items, 100),
    dimension_unit: "cm",
    length: String(draft.pkg.lengthCm),
    width: String(draft.pkg.widthCm),
    height: String(draft.pkg.heightCm),
    weight_unit: "kg",
    weight: draft.pkg.weightKg.toFixed(3),
    declared_value: money(draft.declaredValue),
    num_pieces: String(draft.pkg.pieces),
    customer_reference_number: dtdcReference(draft.orderNumber, options.attempt),
    cod_collection_mode: cod ? options.codCollectionMode : "",
    cod_amount: cod ? money(draft.collectableAmount) : "0",
    commodity_id: options.commodityId,
    reference_number: "",
    consignment_type: "Forward",
    is_risk_surcharge_applicable: false,
    invoice_number: `HZ${draft.orderNumber}`,
    invoice_date: isoDate(now),
    origin_details: party(draft.pickup, draft.pickup.company),
    destination_details: party(draft.consignee),
    // One entry per physical piece. Every piece is described the same way
    // because the store packs one box; the value is split evenly so the
    // pieces add up to the declared value rather than each claiming all of it.
    pieces_detail: Array.from({ length: draft.pkg.pieces }, () => ({
      description: describeContents(draft.items, 100),
      declared_value: money(draft.declaredValue / draft.pkg.pieces),
      weight: (draft.pkg.weightKg / draft.pkg.pieces).toFixed(3),
      height: String(draft.pkg.heightCm),
      length: String(draft.pkg.lengthCm),
      width: String(draft.pkg.widthCm),
    })),
  };
}
