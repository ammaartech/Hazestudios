import type { BlueDartConfig, CourierConfig, DelhiveryConfig, DtdcConfig, ShreeMarutiConfig } from "./config";
import type { ShipmentDraft } from "./draft";
import type { CourierProvider } from "./providers";
import { normalizeShipmentStage, type ShipmentStage } from "./status";
import { BlueDartError, cancelWaybill, generateWaybill, testBlueDartConnection, trackBlueDart } from "./bluedart/client";
import { creditReference, mapDraftToBlueDart } from "./bluedart/map";
import {
  DelhiveryError,
  cancelDelhiveryShipment,
  checkDelhiveryPincode,
  createDelhiveryShipment,
  fetchDelhiveryLabel,
  testDelhiveryConnection,
  trackDelhivery,
} from "./delhivery/client";
import { mapDraftToDelhivery } from "./delhivery/map";
import {
  DtdcError,
  cancelDtdcConsignment,
  checkDtdcServiceability,
  createDtdcConsignment,
  fetchDtdcLabel,
  testDtdcConnection,
  trackDtdc,
} from "./dtdc/client";
import { mapDraftToDtdc } from "./dtdc/map";
import {
  ShreeMarutiError,
  cancelShreeMarutiOrder,
  checkServiceability,
  createShreeMarutiOrder,
  fetchShreeMarutiLabel,
  testShreeMarutiConnection,
  trackShreeMaruti,
} from "./shreemaruti/client";
import { mapDraftToShreeMaruti } from "./shreemaruti/map";

/**
 * One interface over four couriers.
 *
 * `shipments.ts` books, cancels, tracks and prints through this and knows
 * nothing about any courier's wire format; each adapter below is the whole of
 * what a courier needs to say to fit. Adding a fifth partner is a client, a
 * mapper, and an entry here.
 *
 * Every adapter throws its own error class for anything the operator should
 * read — `isCourierError` is how the orchestrator tells "the courier said no,
 * and here is why" from "something broke".
 */

export interface Booked {
  awb: string;
  providerOrderId: string | null;
  providerStatus: string | null;
  /** The label, when the courier hands it back at booking (Blue Dart does). */
  labelPdf: Uint8Array | null;
  destinationArea: string | null;
  destinationLocation: string | null;
  request: unknown;
  response: unknown;
}

export interface LatestStatus {
  providerStatus: string | null;
  stage: ShipmentStage;
  /** When the courier says it happened; null when they do not say. */
  at: string | null;
}

export interface ServiceabilityAnswer {
  serviceable: boolean;
  /** Null when the courier does not say separately. */
  codServiceable: boolean | null;
  reason: string;
  destination: string | null;
}

export interface BookOptions {
  service: string;
  note: string;
  /** 1 for the first booking of this order with this courier, 2 for the next… */
  attempt: number;
}

export interface ShipmentRef {
  awb: string;
  providerOrderId: string | null;
}

export interface CourierAdapter {
  book(config: CourierConfig, draft: ShipmentDraft, options: BookOptions): Promise<Booked>;
  cancel(config: CourierConfig, ref: ShipmentRef, reason: string): Promise<void>;
  track(config: CourierConfig, ref: ShipmentRef): Promise<LatestStatus | null>;
  /** Fetches the label on demand. Absent for couriers that only hand it over at booking. */
  label?(config: CourierConfig, ref: ShipmentRef): Promise<Uint8Array>;
  /** Asks whether the courier delivers to the draft's address. Absent when there is no cheap way to ask. */
  serviceability?(config: CourierConfig, draft: ShipmentDraft): Promise<ServiceabilityAnswer>;
  /** Proves the credentials without booking anything; returns a sentence for the toast. */
  test(config: CourierConfig): Promise<string>;
}

export function isCourierError(cause: unknown): cause is Error {
  return (
    cause instanceof ShreeMarutiError ||
    cause instanceof BlueDartError ||
    cause instanceof DtdcError ||
    cause instanceof DelhiveryError
  );
}

/** Attaches the payload that produced a failure, so the shipment row can keep it. */
function withRequest(cause: unknown, request: unknown): never {
  if (cause && typeof cause === "object") throw Object.assign(cause, { request });
  throw Object.assign(new Error(String(cause)), { request });
}

function expect<C extends CourierConfig>(config: CourierConfig, provider: C["provider"]): C {
  if (config.provider !== provider) throw new Error(`Expected ${provider} credentials, got ${config.provider}.`);
  return config as C;
}

/* -------------------------------------------------------------------------- */
/* Shree Maruti                                                                */
/* -------------------------------------------------------------------------- */

const shreemaruti: CourierAdapter = {
  async book(raw, draft, options) {
    const config = expect<ShreeMarutiConfig>(raw, "shreemaruti");
    const payload = mapDraftToShreeMaruti(draft, {
      service: options.service === "AIR" ? "AIR" : "SURFACE",
      autoManifest: config.autoManifest,
      note: options.note,
    });
    try {
      const order = await createShreeMarutiOrder(config, payload);
      const awb = order.shipments?.find((s) => s.awbNumber)?.awbNumber?.trim() ?? "";
      if (!awb) {
        throw new ShreeMarutiError("Shree Maruti created the order but has not assigned an AWB yet. Check it on their portal.", undefined, order);
      }
      return {
        awb,
        providerOrderId: order.orderId,
        providerStatus: order.orderStatus ?? null,
        labelPdf: null,
        destinationArea: null,
        destinationLocation: null,
        request: payload,
        response: order,
      };
    } catch (cause) {
      return withRequest(cause, payload);
    }
  },
  async cancel(raw, ref, reason) {
    const config = expect<ShreeMarutiConfig>(raw, "shreemaruti");
    if (!ref.providerOrderId) throw new ShreeMarutiError("This booking has no Shree Maruti order id to cancel.");
    await cancelShreeMarutiOrder(config, ref.providerOrderId, reason);
  },
  async track(raw, ref) {
    const config = expect<ShreeMarutiConfig>(raw, "shreemaruti");
    const tracking = await trackShreeMaruti(config, ref.awb);
    if (!tracking) return null;
    const last = tracking.statuses?.length ? tracking.statuses[tracking.statuses.length - 1] : null;
    const status = tracking.orderInformation?.currentStatus ?? last?.status ?? null;
    const ts = last?.statusTimestamp;
    const at =
      typeof ts === "number" ? new Date(ts).toISOString()
      : typeof ts === "string" && /^\d+$/.test(ts) ? new Date(Number(ts)).toISOString()
      : null;
    return { providerStatus: status, stage: normalizeShipmentStage("shreemaruti", status, { hasAwb: true }), at };
  },
  async label(raw, ref) {
    const config = expect<ShreeMarutiConfig>(raw, "shreemaruti");
    if (!ref.providerOrderId) throw new ShreeMarutiError("This booking has no Shree Maruti order id.");
    return fetchShreeMarutiLabel(config, ref.providerOrderId);
  },
  async serviceability(raw, draft) {
    const config = expect<ShreeMarutiConfig>(raw, "shreemaruti");
    const result = await checkServiceability(config, {
      from: draft.pickup?.postal_code ?? "",
      to: draft.consignee.postal_code,
      paymentMode: draft.paymentMode === "cod" ? "COD" : "PREPAID",
    });
    return {
      serviceable: result.serviceable,
      codServiceable: null,
      reason: result.reason,
      destination: [result.destination?.city, result.destination?.state].filter(Boolean).join(", ") || null,
    };
  },
  test: (raw) => testShreeMarutiConnection(expect<ShreeMarutiConfig>(raw, "shreemaruti")),
};

/* -------------------------------------------------------------------------- */
/* Blue Dart                                                                   */
/* -------------------------------------------------------------------------- */

const bluedart: CourierAdapter = {
  async book(raw, draft, options) {
    const config = expect<BlueDartConfig>(raw, "bluedart");
    const request = mapDraftToBlueDart(draft, {
      service: options.service,
      creditReferenceNo: creditReference(draft.orderNumber, options.attempt),
      shipper: {
        customerCode: config.customerCode,
        originArea: config.originArea,
        pickupTime: config.pickupTime,
        registerPickup: config.registerPickup,
      },
      note: options.note,
    });
    try {
      const result = await generateWaybill(config, request);
      return {
        awb: result.AWBNo,
        providerOrderId: null,
        providerStatus: result.Status.map((s) => s.StatusInformation).filter(Boolean).join("; ") || null,
        labelPdf: result.labelPdf,
        destinationArea: result.DestinationArea,
        destinationLocation: result.DestinationLocation,
        request,
        response: result.raw,
      };
    } catch (cause) {
      return withRequest(cause, request);
    }
  },
  async cancel(raw, ref) {
    await cancelWaybill(expect<BlueDartConfig>(raw, "bluedart"), ref.awb);
  },
  async track(raw, ref) {
    const config = expect<BlueDartConfig>(raw, "bluedart");
    const tracking = await trackBlueDart(config, ref.awb, config.trackingLicenceKey || undefined);
    if (!tracking) return null;
    return {
      providerStatus: tracking.status || null,
      stage: normalizeShipmentStage("bluedart", tracking.status, { statusType: tracking.statusType, hasAwb: true }),
      at: null,
    };
  },
  test: (raw) => testBlueDartConnection(expect<BlueDartConfig>(raw, "bluedart")),
};

/* -------------------------------------------------------------------------- */
/* DTDC                                                                        */
/* -------------------------------------------------------------------------- */

const dtdc: CourierAdapter = {
  async book(raw, draft, options) {
    const config = expect<DtdcConfig>(raw, "dtdc");
    const consignment = mapDraftToDtdc(draft, {
      service: options.service,
      customerCode: config.customerCode,
      commodityId: config.commodityId,
      codCollectionMode: config.codCollectionMode,
      attempt: options.attempt,
    });
    // Stored as the exact wire body, wrapper included, so a refused booking
    // can be replayed from the row.
    const request = { consignments: [consignment] };
    try {
      const result = await createDtdcConsignment(config, consignment);
      return {
        awb: result.consignmentNo,
        providerOrderId: null,
        providerStatus: null,
        labelPdf: null,
        destinationArea: null,
        destinationLocation: null,
        request,
        response: result.raw,
      };
    } catch (cause) {
      return withRequest(cause, request);
    }
  },
  async cancel(raw, ref) {
    await cancelDtdcConsignment(expect<DtdcConfig>(raw, "dtdc"), ref.awb);
  },
  async track(raw, ref) {
    const config = expect<DtdcConfig>(raw, "dtdc");
    const tracking = await trackDtdc(config, ref.awb);
    if (!tracking) return null;
    // Their scans carry the sentence; the header carries a short status.
    // Both are tried, the more specific first.
    const text = [tracking.status, tracking.remarks].filter(Boolean).join(" — ");
    return {
      providerStatus: tracking.status || null,
      stage: normalizeShipmentStage("dtdc", text, { hasAwb: true }),
      at: null,
    };
  },
  label: (raw, ref) => fetchDtdcLabel(expect<DtdcConfig>(raw, "dtdc"), ref.awb),
  async serviceability(_raw, draft) {
    const result = await checkDtdcServiceability(draft.pickup?.postal_code ?? "", draft.consignee.postal_code);
    return {
      serviceable: result.serviceable,
      codServiceable: result.cod,
      reason: result.message ?? (result.serviceable ? "" : "Not serviceable for B2C parcels"),
      // Their lookup answers "BANGALORE, BANGALORE" for a metro; say it once.
      destination: [...new Set([result.city, result.state].filter(Boolean))].join(", ") || null,
    };
  },
  test: (raw) => testDtdcConnection(expect<DtdcConfig>(raw, "dtdc")),
};

/* -------------------------------------------------------------------------- */
/* Delhivery                                                                   */
/* -------------------------------------------------------------------------- */

const delhivery: CourierAdapter = {
  async book(raw, draft, options) {
    const config = expect<DelhiveryConfig>(raw, "delhivery");
    const manifest = mapDraftToDelhivery(draft, {
      service: options.service === "Express" ? "Express" : "Surface",
      pickupLocation: config.pickupLocation,
      sellerName: draft.pickup?.company || draft.pickup?.name || "",
      sellerAddress: [draft.pickup?.address1, draft.pickup?.city, draft.pickup?.postal_code].filter(Boolean).join(", "),
      sellerGstin: config.sellerGstin,
      attempt: options.attempt,
      note: options.note,
    });
    try {
      const result = await createDelhiveryShipment(config, manifest);
      return {
        awb: result.waybill,
        providerOrderId: result.refnum,
        providerStatus: "Manifested",
        labelPdf: null,
        destinationArea: result.sortCode,
        destinationLocation: null,
        request: manifest,
        response: result.raw,
      };
    } catch (cause) {
      return withRequest(cause, manifest);
    }
  },
  async cancel(raw, ref) {
    await cancelDelhiveryShipment(expect<DelhiveryConfig>(raw, "delhivery"), ref.awb);
  },
  async track(raw, ref) {
    const config = expect<DelhiveryConfig>(raw, "delhivery");
    const tracking = await trackDelhivery(config, ref.awb);
    if (!tracking) return null;
    const stage = normalizeShipmentStage("delhivery", tracking.status, { statusType: tracking.statusType, hasAwb: true });
    // An NDR reason lives in Instructions ("Consignee unavailable") while
    // the status stays "Pending"; surface it as the courier's words.
    const providerStatus = [tracking.status, tracking.instructions].filter(Boolean).join(" — ") || null;
    const at = tracking.statusDateTime && !Number.isNaN(Date.parse(tracking.statusDateTime))
      ? new Date(tracking.statusDateTime).toISOString()
      : null;
    return { providerStatus, stage, at };
  },
  label: (raw, ref) => fetchDelhiveryLabel(expect<DelhiveryConfig>(raw, "delhivery"), ref.awb),
  async serviceability(raw, draft) {
    const config = expect<DelhiveryConfig>(raw, "delhivery");
    const result = await checkDelhiveryPincode(config, draft.consignee.postal_code);
    const wantsCod = draft.paymentMode === "cod";
    return {
      serviceable: result.serviceable && (wantsCod ? result.cod : result.prepaid || result.cod),
      codServiceable: result.cod,
      reason: result.remark ?? (!result.serviceable ? "Pincode not serviced" : wantsCod && !result.cod ? "COD not available at this pincode" : ""),
      destination: [result.district, result.stateCode].filter(Boolean).join(", ") || null,
    };
  },
  test: (raw) => testDelhiveryConnection(expect<DelhiveryConfig>(raw, "delhivery")),
};

export const ADAPTERS: Record<CourierProvider, CourierAdapter> = { shreemaruti, bluedart, dtdc, delhivery };

export function adapterFor(provider: CourierProvider): CourierAdapter {
  return ADAPTERS[provider];
}
