import { describeContents, volumetricWeightKg, type ShipmentDraft, type ShipmentParty } from "../draft";
import { ECOMM_CARRIER, type SmAddress, type SmOrderPayload } from "./client";

/**
 * A shipment draft as an InnoFulfill ECOMM order.
 *
 * The docs' own example is the template (docs.innofulfill.com → Booking →
 * Create ECOMM Order), and two of its rules are load-bearing:
 *   - `parcelCategory` and `deliveryPromise` must both be ECOMM;
 *   - `carrierName` and `carrierId` are static values for the SMILE network.
 *
 * Addresses go in fourfold — PICKUP, DELIVERY, BILLING, RETURN. Only the first
 * two are required, but the label prints the return address and COD
 * reconciliation uses billing, so all four are sent and none is guessed:
 * billing is the delivery address (this store does not take a separate
 * billing address at checkout for COD), and return is the configured return
 * address or, failing that, the pickup.
 *
 * `referenceId` is our order number: it is what appears on their dashboard and
 * in webhook payloads, and it keeps an order trivial to find on both sides.
 */

const INDIA = "India";

function toAddress(type: SmAddress["type"], party: ShipmentParty): SmAddress {
  const street = [party.address1, party.address2].filter(Boolean).join(", ");
  return {
    type,
    zip: party.postal_code,
    name: party.name.slice(0, 100),
    phone: party.phone,
    email: party.email,
    street,
    landmark: party.landmark ?? "",
    city: party.city,
    state: party.state,
    // Their schema wants a country *name*; checkout stores a code.
    country: INDIA,
    addressName: [street, party.landmark, party.city, party.state, party.postal_code, INDIA]
      .filter(Boolean)
      .join(", "),
    ...(party.gst_number ? { GSTNumber: party.gst_number } : {}),
  };
}

export function mapDraftToShreeMaruti(
  draft: ShipmentDraft,
  options: { service: "SURFACE" | "AIR"; autoManifest: boolean; note?: string }
): SmOrderPayload {
  if (!draft.pickup) throw new Error("A pickup address is required to build a Shree Maruti order.");
  const returnTo = draft.returnTo ?? draft.pickup;

  const cod = draft.paymentMode === "cod";
  const subTotal = round2(draft.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0));

  return {
    referenceId: String(draft.orderNumber),
    orderDate: new Date().toISOString(),
    orderType: "FORWARD",
    orderStatus: "CONFIRMED",
    parcelCategory: "ECOMM",
    deliveryPromise: "ECOMM",
    deliveryMode: options.service,
    autoManifest: options.autoManifest,
    eWaybills: [],
    documentType: "",
    // Prices here are tax-inclusive retail prices; there is no separate GST
    // line on the order to itemise, and inventing one would misstate it.
    taxes: [],
    discounts: [],
    metadata: { source: "hazestudios_admin" },
    documents: [],
    addresses: [
      toAddress("PICKUP", draft.pickup),
      toAddress("DELIVERY", draft.consignee),
      toAddress("BILLING", draft.consignee),
      toAddress("RETURN", returnTo),
    ],
    shipments: [
      {
        dimensions: {
          length: draft.pkg.lengthCm,
          width: draft.pkg.widthCm,
          height: draft.pkg.heightCm,
        },
        shipmentStatus: "CONFIRMED",
        // Blank: the carrier assigns one. Sending our own would require a
        // pre-allocated AWB series, which this account does not have.
        awbNumber: "",
        physicalWeight: draft.pkg.weightKg,
        physicalWeightUnit: "KG",
        volumetricWeight: volumetricWeightKg(draft.pkg),
        note: (options.note ?? "").slice(0, 200),
        items: draft.items.map((item) => ({
          name: item.name.slice(0, 100),
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          sku: item.sku.slice(0, 50),
          hsnCode: "",
          description: describeContents([item], 50),
        })),
      },
    ],
    carrierId: ECOMM_CARRIER.carrierId,
    carrierName: ECOMM_CARRIER.carrierName,
    payment: {
      type: cod ? "COD" : "PREPAID",
      currency: draft.currency || "INR",
      paymentMethod: cod ? "CASH" : "ONLINE",
      // The amount the courier collects from the end customer. Their published
      // example carries this entry with 0 for a prepaid order; for COD it is
      // the balance due — which for a partial-COD order is total minus the
      // advance already captured online (see buildShipmentDraft).
      customerCharges: [{ chargeKey: "end_customer", chargeValue: draft.collectableAmount, breakup: [] }],
      breakdown: { subTotal },
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
