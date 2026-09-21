import { describeContents, type ShipmentDraft, type ShipmentParty } from "../draft";
import type { BdConsignee, BdReturnAddress, BdShipper, BdWaybillRequest } from "./client";

/**
 * A shipment draft as a Blue Dart GenerateWayBill request.
 *
 * Blue Dart's field limits come from their developer guide and are enforced
 * here rather than left to their validator, because their validator answers
 * with a status code and ours answers with a sentence: names are 30
 * characters, address lines 30 each across three lines, the credit reference
 * 20 alphanumerics and unique per waybill. Anything longer is cut, never
 * refused — a long street name is not a reason to fail a booking.
 *
 * The money fields follow the e-tailing convention: `SubProductCode` "C" with
 * a `CollectableAmount` for COD, "P" with zero for prepaid, and
 * `DeclaredValue` as the goods' value either way.
 */

/** What the account needs to say about itself on every waybill. */
export interface BlueDartShipperSettings {
  customerCode: string;
  originArea: string;
  /** "HHMM". */
  pickupTime: string;
  registerPickup: boolean;
}

export interface BlueDartBookingOptions {
  /** Product code: A, D or E. */
  service: string;
  /** Unique per waybill on this account; see `creditReference`. */
  creditReferenceNo: string;
  shipper: BlueDartShipperSettings;
  /** Our clock, so the pickup date is deterministic in tests. */
  now?: Date;
  note?: string;
}

const NAME_MAX = 30;
const LINE_MAX = 30;
const REF_MAX = 20;

/** Splits a street address into up to three 30-character lines at word boundaries. */
export function addressLines(party: ShipmentParty, max = LINE_MAX): [string, string, string] {
  const words = [party.address1, party.address2, party.landmark]
    .filter(Boolean)
    .join(", ")
    .split(/\s+/)
    .filter(Boolean);

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (lines.length === 3) break;
    // A single word longer than a line is hard-split; nothing else can be.
    if (word.length > max) {
      if (current) lines.push(current);
      current = "";
      for (let i = 0; i < word.length && lines.length < 3; i += max) lines.push(word.slice(i, i + max));
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length <= max) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current && lines.length < 3) lines.push(current);

  // Whatever did not fit is dropped from the third line rather than the
  // first: the house number and street come first in every address and are
  // what the courier needs; the trailing "near the temple" is the part that
  // can go.
  return [lines[0] ?? "", lines[1] ?? "", lines[2] ?? ""];
}

/**
 * Blue Dart's `CreditReferenceNo` must be unique per waybill on the account,
 * alphanumeric, at most 20 characters, and re-using one is refused with
 * "Waybill already generated". `HZ<order>` for the first booking, `HZ<order>R2`
 * for a re-booking after a cancellation, and so on.
 */
export function creditReference(orderNumber: number, attempt: number): string {
  const base = `HZ${orderNumber}`;
  const ref = attempt > 1 ? `${base}R${attempt}` : base;
  return ref.replace(/[^A-Za-z0-9]/g, "").slice(0, REF_MAX);
}

/** Blue Dart serialises dates as `/Date(<epoch ms>)/`. */
export function blueDartDate(date: Date): string {
  return `/Date(${date.getTime()})/`;
}

/**
 * The pickup is today unless the configured pickup time has already passed in
 * India, in which case it is tomorrow — asking for a 16:00 pickup at 18:00 is
 * refused, and a booking at night is for the next morning anyway.
 */
export function pickupDate(now: Date, pickupTime: string): Date {
  const IST_OFFSET_MIN = 330;
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const hhmm = /^(\d{2})(\d{2})$/.exec(pickupTime);
  const cutoffMinutes = hhmm ? Number(hhmm[1]) * 60 + Number(hhmm[2]) : 16 * 60;
  const nowMinutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const date = new Date(now);
  if (nowMinutes >= cutoffMinutes) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function cut(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

export function mapDraftToBlueDart(draft: ShipmentDraft, options: BlueDartBookingOptions): BdWaybillRequest {
  if (!draft.pickup) throw new Error("A pickup address is required to build a Blue Dart waybill.");
  const pickup = draft.pickup;
  const returnTo = draft.returnTo ?? pickup;
  const now = options.now ?? new Date();
  const cod = draft.paymentMode === "cod";

  const [c1, c2, c3] = addressLines(draft.consignee);
  const [s1, s2, s3] = addressLines(pickup);
  const [r1, r2, r3] = addressLines(returnTo);

  const consignee: BdConsignee = {
    ConsigneeName: cut(draft.consignee.name, NAME_MAX),
    ConsigneeAddress1: c1,
    ConsigneeAddress2: c2,
    ConsigneeAddress3: c3,
    // Residential. Everything this store ships goes to a home.
    ConsigneeAddressType: "R",
    ConsigneeAttention: "",
    ConsigneeEmailID: cut(draft.consignee.email, 50),
    ConsigneeGSTNumber: "",
    ConsigneeLatitude: "",
    ConsigneeLongitude: "",
    ConsigneeMaskedContactNumber: "",
    ConsigneeMobile: draft.consignee.phone,
    ConsigneePincode: draft.consignee.postal_code,
    ConsigneeTelephone: "",
  };

  const shipper: BdShipper = {
    CustomerName: cut(pickup.company || pickup.name, NAME_MAX),
    CustomerAddress1: s1,
    CustomerAddress2: s2,
    CustomerAddress3: s3,
    CustomerCode: options.shipper.customerCode,
    CustomerEmailID: cut(pickup.email, 50),
    CustomerGSTNumber: pickup.gst_number,
    CustomerLatitude: "",
    CustomerLongitude: "",
    CustomerMaskedContactNumber: "",
    CustomerMobile: pickup.phone,
    CustomerPincode: pickup.postal_code,
    CustomerTelephone: "",
    IsToPayCustomer: false,
    OriginArea: options.shipper.originArea.toUpperCase(),
    Sender: cut(pickup.name || pickup.company, 20),
    VendorCode: "",
  };

  const returnadds: BdReturnAddress = {
    ManifestNumber: "",
    ReturnAddress1: r1,
    ReturnAddress2: r2,
    ReturnAddress3: r3,
    ReturnContact: cut(returnTo.name || returnTo.company, 20),
    ReturnEmailID: cut(returnTo.email, 50),
    ReturnLatitude: "",
    ReturnLongitude: "",
    ReturnMaskedContactNumber: "",
    ReturnMobile: returnTo.phone,
    ReturnPincode: returnTo.postal_code,
    ReturnTelephone: "",
  };

  const invoiceDate = blueDartDate(now);

  return {
    Consignee: consignee,
    Shipper: shipper,
    Returnadds: returnadds,
    Services: {
      // Blank: Blue Dart allocates from the account's series.
      AWBNo: "",
      ActualWeight: draft.pkg.weightKg.toFixed(2),
      CollectableAmount: cod ? draft.collectableAmount : 0,
      Commodity: {
        CommodityDetail1: describeContents(draft.items, 30),
        CommodityDetail2: "",
        CommodityDetail3: "",
      },
      CreditReferenceNo: options.creditReferenceNo,
      DeclaredValue: draft.declaredValue,
      Dimensions: [
        {
          Length: draft.pkg.lengthCm,
          Breadth: draft.pkg.widthCm,
          Height: draft.pkg.heightCm,
          Count: draft.pkg.pieces,
        },
      ],
      ECCN: "",
      InvoiceNo: cut(`HZ${draft.orderNumber}`, 10),
      // We want the label back: it is the only time Blue Dart offers it.
      PDFOutputNotRequired: false,
      PackType: "",
      PickupDate: blueDartDate(pickupDate(now, options.shipper.pickupTime)),
      PickupTime: options.shipper.pickupTime,
      PieceCount: String(draft.pkg.pieces),
      ProductCode: options.service,
      // 1 = Dutiables (non-documents). Their enum is Docs=0, Dutiables=1, and
      // a garment is not a document; Dart Apex and Surfaceline are both
      // non-document products and refuse Dox.
      ProductType: 1,
      RegisterPickup: options.shipper.registerPickup,
      SpecialInstruction: cut(options.note ?? "", 100),
      // E-tailing sub-products: C = COD, P = Prepaid.
      SubProductCode: cod ? "C" : "P",
      OTPBasedDelivery: 0,
      OTPCode: "",
      // Item lines are what their e-waybill and invoice checks read for
      // e-tailing shipments; a bare parcel with a declared value and no items
      // is refused on some accounts.
      itemdtl: draft.items.map((item, i) => ({
        ItemID: cut(item.sku || `ITEM${i + 1}`, 15),
        ItemName: cut(item.name, 50),
        ItemValue: round2(item.unitPrice * item.quantity),
        Itemquantity: item.quantity,
        ProductDesc1: cut(item.name, 50),
        ProductDesc2: "",
        InvoiceNumber: cut(`HZ${draft.orderNumber}`, 15),
        InvoiceDate: invoiceDate,
        SellerName: cut(pickup.company || pickup.name, 30),
        SellerGSTNNumber: pickup.gst_number,
        docType: "INV",
      })),
      noOfDCGiven: 0,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
