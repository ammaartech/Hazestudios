/**
 * The couriers the admin can book a parcel with, and what each one calls its
 * services.
 *
 * Pure data with no server imports, so the "Ship now" dialog (a Client
 * Component) and the booking code share one list. Anything that needs a
 * credential lives in `config.ts` and never crosses to the browser.
 *
 * Two partners, two very different APIs, one shape here. Shree Maruti's
 * e-commerce platform (InnoFulfill, branded SMILE) books an *order* and picks a
 * service by delivery mode; Blue Dart generates a *waybill* and picks a service
 * by product code. `service` below is whichever of those the courier wants,
 * stored verbatim on the shipment row.
 */

export type CourierProvider = "shreemaruti" | "bluedart";

export const COURIER_PROVIDERS: CourierProvider[] = ["shreemaruti", "bluedart"];

export function isCourierProvider(value: unknown): value is CourierProvider {
  return value === "shreemaruti" || value === "bluedart";
}

export interface CourierService {
  /** The courier's own code, sent as-is. */
  code: string;
  label: string;
  /** One line the operator can pick on: speed, ground/air, what it suits. */
  hint: string;
}

export interface CourierMeta {
  provider: CourierProvider;
  /** The partner's name as they spell it. */
  name: string;
  /** Where the credentials and pickup address are entered. */
  settingsHref: string;
  services: CourierService[];
  /** The public tracking page for an AWB, for the shopper and the timeline. */
  trackingUrl: (awb: string) => string;
  /** How the AWB is described on their side, for labels in the UI. */
  awbLabel: string;
}

export const COURIERS: Record<CourierProvider, CourierMeta> = {
  shreemaruti: {
    provider: "shreemaruti",
    name: "Shree Maruti",
    settingsHref: "/admin/settings/shipping#shreemaruti",
    // InnoFulfill's `deliveryMode`. The docs list exactly these two.
    services: [
      { code: "SURFACE", label: "Surface", hint: "Ground network — cheaper, 3–6 days" },
      { code: "AIR", label: "Air", hint: "Air network — faster, costs more" },
    ],
    trackingUrl: (awb) => `https://tracking.shreemaruti.com/track-order/${encodeURIComponent(awb)}`,
    awbLabel: "AWB",
  },
  bluedart: {
    provider: "bluedart",
    name: "Blue Dart",
    settingsHref: "/admin/settings/shipping#bluedart",
    // Blue Dart's domestic `ProductCode`s. Dart Apex is the one their
    // e-tailing accounts are set up on; Surfaceline is the ground option;
    // Domestic Priority is the premium air product. Which of these an account
    // may actually book is decided by the contract, and a code the account
    // does not have is refused at booking with a message that says so.
    services: [
      { code: "D", label: "Dart Apex", hint: "Air express for parcels — the usual e-commerce product" },
      { code: "E", label: "Dart Surfaceline", hint: "Ground — cheaper, slower, heavier parcels" },
      { code: "A", label: "Domestic Priority", hint: "Premium air — next-day to metros" },
    ],
    trackingUrl: (awb) => `https://www.bluedart.com/tracking?trackFor=0&trackNo=${encodeURIComponent(awb)}`,
    awbLabel: "Waybill",
  },
};

export function courierName(provider: CourierProvider): string {
  return COURIERS[provider].name;
}

export function serviceLabel(provider: CourierProvider, code: string): string {
  return COURIERS[provider].services.find((s) => s.code === code)?.label ?? code;
}
