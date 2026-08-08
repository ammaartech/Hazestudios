import { nationalPhoneDigits } from "@/lib/shop/phone-codes";
import type { Order, OrderItem } from "@/lib/types";
import type { QikinkAddress, QikinkLineItem, QikinkOrderPayload } from "./client";

/**
 * Translating a Hazestudios order into Qikink's create-order payload.
 *
 * The join between the two systems is the SKU and nothing else. Qikink's Open
 * API has no product endpoints and no equivalent of the dashboard's "Map
 * Products" screen — that fallback exists only for Shopify and WooCommerce. So
 * `search_from_my_products: 1` either finds the SKU in the merchant's My
 * Products or the order fails, and every SKU has to be right before we send.
 *
 * Which is why this module validates loudly and refuses to send a partial
 * order: a line item silently dropped here is a customer who paid for two
 * garments and receives one.
 */

/** A line item with its SKU resolved from the variant (or the product). */
export interface ResolvedItem {
  item: OrderItem;
  sku: string;
}

export interface MappedOrder {
  payload: QikinkOrderPayload;
}

export interface MappingFailure {
  /** Operator-facing reasons, all of them, so one fix round covers everything. */
  problems: string[];
}

export type MappingResult = MappedOrder | MappingFailure;

export function isMappingFailure(result: MappingResult): result is MappingFailure {
  return "problems" in result;
}

/** Qikink takes money as plain decimal strings. */
const money = (value: number) => value.toFixed(2);

/**
 * `country` is stored as a 2-letter code by checkout, which is already what
 * Qikink wants for `country_code`.
 */
function buildAddress(order: Order): { address: QikinkAddress; problems: string[] } {
  const a = order.shipping_address ?? {};
  const problems: string[] = [];

  const required: [keyof QikinkAddress, string, string][] = [
    ["first_name", a.first_name, "first name"],
    ["address1", a.address1, "street address"],
    ["city", a.city, "city"],
    ["zip", a.postal_code, "postcode"],
    ["province", a.province, "state/province"],
    ["country_code", a.country, "country"],
  ];

  for (const [, value, label] of required) {
    if (!value?.trim()) problems.push(`Shipping address is missing a ${label}.`);
  }

  // Qikink requires both on every order, and they live on the order rather
  // than the address blob. Checked on the *normalised* number: an order holding
  // only a dialling code would pass a non-empty test and still send nothing a
  // courier can ring.
  if (nationalPhoneDigits(order.phone ?? "").length < 7) {
    problems.push("Order has no usable phone number, which Qikink requires.");
  }
  if (!order.email?.trim()) problems.push("Order has no email address, which Qikink requires.");

  return {
    address: {
      first_name: a.first_name ?? "",
      // Empty string, never omitted — Qikink reads both of these keys without
      // checking they exist, so a missing one is a 500 on their side.
      last_name: a.last_name ?? "",
      address1: a.address1 ?? "",
      address2: a.address2 ?? "",
      // Normalised to the plain national digits Qikink's courier expects.
      // Checkout stores phones with their dialling code (`+91 9876543210`), and
      // sending that string through verbatim would hand an Indian printer a
      // country code and two separators it never asked for. This also cleans up
      // whatever historic orders hold, which is whatever the shopper typed.
      phone: nationalPhoneDigits(order.phone ?? ""),
      email: order.email ?? "",
      city: a.city ?? "",
      zip: a.postal_code ?? "",
      // Qikink matches on a correctly spelled state *name*, not a code. Passed
      // through as entered; a mismatch is rejected by them, not caught here.
      province: a.province ?? "",
      country_code: (a.country ?? "").toUpperCase(),
    },
    problems,
  };
}

/**
 * Builds the payload, or the list of reasons it cannot be built.
 *
 * `qikink_shipping` is fixed at "1" (Qikink ships to the customer) because that
 * is the dropshipping arrangement this integration exists to serve; self-ship
 * would mean the merchant handles logistics and needs no address pushed at all.
 */
export function mapOrderToQikink(
  order: Order,
  items: ResolvedItem[]
): MappingResult {
  const problems: string[] = [];

  if (!items.length) problems.push("Order has no line items.");

  const missingSku = items.filter((i) => !i.sku.trim());
  for (const { item } of missingSku) {
    problems.push(
      `“${item.title_snapshot}${item.variant_snapshot ? ` — ${item.variant_snapshot}` : ""}” has no SKU. ` +
        "Set it to the matching Qikink My Products SKU."
    );
  }

  const { address, problems: addressProblems } = buildAddress(order);
  problems.push(...addressProblems);

  if (problems.length) return { problems };

  const line_items: QikinkLineItem[] = items.map(({ item, sku }) => ({
    // 1 = Qikink resolves the garment, design, print type and placement from
    // its own My Products record. Everything design-related therefore lives in
    // Qikink, and this store only has to agree on the SKU.
    search_from_my_products: 1,
    sku: sku.trim(),
    quantity: String(item.quantity),
    price: money(item.price_snapshot),
  }));

  return {
    payload: {
      // Their `order_number` must be unique and never reused. Ours is a
      // monotonic integer, so it satisfies that without a prefix — and keeping
      // it identical makes an order trivial to find on both dashboards.
      order_number: String(order.order_number),
      qikink_shipping: "1",
      // Prepaid means the money is already with us. Anything not yet paid is
      // collected on delivery, which is what Qikink's courier will do.
      gateway: order.payment_status === "paid" ? "Prepaid" : "COD",
      total_order_value: money(order.total),
      line_items,
      shipping_address: address,
    },
  };
}
