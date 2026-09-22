/**
 * Checks the courier integrations' pure logic — the parts that fail silently
 * if they are wrong and cannot be exercised against the real APIs until the
 * credentials arrive.
 *
 *   npm run verify:couriers
 *
 *   1. **The draft.** An order becomes a parcel: the collectable amount for
 *      COD, partial-COD and prepaid orders; the validation that stops a
 *      booking with a bad pincode or no pickup address; the SKU fallback.
 *   2. **All four payload mappings.** Shree Maruti's four addresses and
 *      payment block; Blue Dart's 30-character address lines, COD sub-product,
 *      unique credit reference, pickup-date rollover and `/Date()/` format;
 *      DTDC's consignment with per-piece detail and COD collection mode;
 *      Delhivery's manifest with grams, IST order date, special-character
 *      scrubbing and the registered pickup name.
 *   3. **Stage normalisation** for every courier's vocabulary, including the
 *      orderings that matter ("RTO delivered" is a return, not a delivery;
 *      Delhivery's "Pending" means different things under UD and RT).
 *   4. **Response parsing** across the envelopes each gateway uses, several
 *      of them captured live.
 *   5. **The Shree Maruti webhook signature**, hex and base64, and rejection of
 *      a tampered body, a wrong key and a stale timestamp.
 *
 * Runs against the source through the TS resolve hook — no build step.
 */

import { createHmac } from "node:crypto";
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);

const draftMod = await import("../src/lib/couriers/draft.ts");
const status = await import("../src/lib/couriers/status.ts");
const smMap = await import("../src/lib/couriers/shreemaruti/map.ts");
const bdMap = await import("../src/lib/couriers/bluedart/map.ts");
const bdClient = await import("../src/lib/couriers/bluedart/client.ts");
const smClient = await import("../src/lib/couriers/shreemaruti/client.ts");
const webhook = await import("../src/lib/couriers/shreemaruti/webhook.ts");
const dtMap = await import("../src/lib/couriers/dtdc/map.ts");
const dtClient = await import("../src/lib/couriers/dtdc/client.ts");
const dlMap = await import("../src/lib/couriers/delhivery/map.ts");
const dlClient = await import("../src/lib/couriers/delhivery/client.ts");

let failures = 0;
function check(label, ok, detail = "") {
  const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const order = {
  id: "11111111-1111-4111-8111-111111111111",
  order_number: 7699,
  is_draft: false,
  cancelled_at: null,
  fulfillment_status: "unfulfilled",
  payment_status: "pending",
  payment_method: "cod",
  total: 1499,
  amount_paid: 0,
  currency: "INR",
  email: "shopper@example.com",
  phone: "+91 98765 43210",
  shipping_address: {
    first_name: "Aarav",
    last_name: "Mehta",
    address1: "Flat 12B, Sunrise Residency, Near the old temple on the main road",
    address2: "Sector 21",
    city: "Surat",
    province: "Gujarat",
    postal_code: "395006",
    country: "IN",
  },
  held_at: null,
  released_at: null,
};

const items = [
  { id: "a1", order_id: order.id, product_id: "p1", variant_id: "v1", title_snapshot: "Haze Hoodie", variant_snapshot: "Black / L", price_snapshot: 999, quantity: 1 },
  { id: "a2", order_id: order.id, product_id: "p2", variant_id: null, title_snapshot: "Sticker pack", variant_snapshot: "", price_snapshot: 250, quantity: 2 },
];

const pickup = {
  name: "Ammaar",
  company: "Haze Studios",
  phone: "9876500000",
  email: "ship@hazestudios.in",
  address1: "14, Industrial Estate",
  address2: "",
  landmark: "",
  city: "Mumbai",
  state: "Maharashtra",
  postal_code: "400008",
  country: "IN",
  gst_number: "",
};

const settings = { pickup, returnAddress: null, packageDefaults: draftMod.DEFAULT_PACKAGE };

/* -------------------------------------------------------------------------- */
/* 1. Draft                                                                    */
/* -------------------------------------------------------------------------- */

section("1. Draft");
{
  const d = draftMod.buildShipmentDraft({ order, items, settings, skus: new Map([["a1", "HZ-HOOD-BLK-L"]]) });
  check("COD order has no problems", d.problems.length === 0, d.problems.join(" | "));
  check("COD collects the full total", d.paymentMode === "cod" && d.collectableAmount === 1499, `${d.paymentMode} ${d.collectableAmount}`);
  check("declared value is the order total", d.declaredValue === 1499);
  check("consignee phone is ten national digits", d.consignee.phone === "9876543210", d.consignee.phone);
  check("catalogue SKU used when present", d.items[0].sku === "HZ-HOOD-BLK-L", d.items[0].sku);
  check("fallback SKU when catalogue has none", /^HZ-[A-Z0-9]+$/.test(d.items[1].sku), d.items[1].sku);
  check("item count sums quantities", d.itemCount === 3);
  check("package defaults applied", d.pkg.weightKg === 0.5 && d.pkg.pieces === 1);

  const partial = draftMod.buildShipmentDraft({ order: { ...order, amount_paid: 500 }, items, settings });
  check("partial COD collects the balance only", partial.collectableAmount === 999, String(partial.collectableAmount));

  const prepaid = draftMod.buildShipmentDraft({ order: { ...order, payment_status: "paid", payment_method: "prepaid" }, items, settings });
  check("paid order is prepaid with nothing to collect", prepaid.paymentMode === "prepaid" && prepaid.collectableAmount === 0);

  const unpaidPrepaid = draftMod.buildShipmentDraft({ order: { ...order, payment_method: "prepaid" }, items, settings });
  check("unpaid prepaid order warns and books as COD", unpaidPrepaid.paymentMode === "cod" && unpaidPrepaid.warnings.length === 1, unpaidPrepaid.warnings[0]);

  const held = draftMod.buildShipmentDraft({ order: { ...order, held_at: "2026-09-20T00:00:00Z" }, items, settings });
  check("held order warns rather than blocks", held.problems.length === 0 && held.warnings.some((w) => /held for COD review/.test(w)));

  const badPin = draftMod.buildShipmentDraft({ order: { ...order, shipping_address: { ...order.shipping_address, postal_code: "3950" } }, items, settings });
  check("bad pincode blocks", badPin.problems.some((p) => /pincode/.test(p)), badPin.problems.join(" | "));

  const noPickup = draftMod.buildShipmentDraft({ order, items, settings: { ...settings, pickup: null } });
  check("missing pickup address blocks", noPickup.problems.some((p) => /No pickup address/.test(p)));

  const badPhone = draftMod.buildShipmentDraft({ order: { ...order, phone: "+91 12" }, items, settings });
  check("unusable phone blocks", badPhone.problems.some((p) => /phone/.test(p)));

  const abroad = draftMod.buildShipmentDraft({ order: { ...order, shipping_address: { ...order.shipping_address, country: "US" } }, items, settings });
  check("non-Indian destination blocks", abroad.problems.some((p) => /outside India/.test(p)));

  const overweight = draftMod.buildShipmentDraft({ order, items, settings, pkg: { weightKg: 80 } });
  check("out-of-range weight blocks", overweight.problems.some((p) => /Weight must be/.test(p)));

  const fulfilled = draftMod.buildShipmentDraft({ order: { ...order, fulfillment_status: "fulfilled" }, items, settings });
  check("already-fulfilled order blocks", fulfilled.problems.some((p) => /already marked fulfilled/.test(p)));

  check("volumetric weight is L×W×H/5000", draftMod.volumetricWeightKg({ lengthCm: 30, widthCm: 25, heightCm: 5 }) === 0.75);
}

/* -------------------------------------------------------------------------- */
/* 2. Mappings                                                                 */
/* -------------------------------------------------------------------------- */

section("2. Shree Maruti payload");
{
  const d = draftMod.buildShipmentDraft({ order, items, settings });
  const p = smMap.mapDraftToShreeMaruti(d, { service: "AIR", autoManifest: true });
  const types = p.addresses.map((a) => a.type);
  check("four addresses in order", types.join(",") === "PICKUP,DELIVERY,BILLING,RETURN", types.join(","));
  check("return falls back to pickup", p.addresses[3].zip === "400008" && p.addresses[3].name === "Ammaar");
  check("delivery address carries the shopper", p.addresses[1].zip === "395006" && p.addresses[1].phone === "9876543210");
  check("country is a name, not a code", p.addresses[1].country === "India");
  check("ECOMM category and promise match", p.parcelCategory === "ECOMM" && p.deliveryPromise === "ECOMM");
  check("static carrier ids", p.carrierName === "innofulfill_ecomm" && p.carrierId === "dee69b40-c0f3-4a44-879a-8b6f6849efaa");
  check("delivery mode from the chosen service", p.deliveryMode === "AIR");
  check("COD payment block", p.payment.type === "COD" && p.payment.paymentMethod === "CASH" && p.payment.customerCharges[0].chargeValue === 1499);
  check("reference is the order number", p.referenceId === "7699");
  check("AWB left blank for the carrier", p.shipments[0].awbNumber === "");
  check("volumetric weight sent", p.shipments[0].volumetricWeight === 0.75);
  check("items carry quantity and unit price", p.shipments[0].items[1].quantity === 2 && p.shipments[0].items[1].unitPrice === 250);

  const prepaid = smMap.mapDraftToShreeMaruti(draftMod.buildShipmentDraft({ order: { ...order, payment_status: "paid" }, items, settings }), { service: "SURFACE", autoManifest: false });
  check("prepaid payment block", prepaid.payment.type === "PREPAID" && prepaid.payment.paymentMethod === "ONLINE" && prepaid.payment.customerCharges[0].chargeValue === 0);
  check("autoManifest passes through", prepaid.autoManifest === false);
}

section("2. Blue Dart payload");
{
  const d = draftMod.buildShipmentDraft({ order, items, settings });
  const now = new Date("2026-09-21T05:00:00Z"); // 10:30 IST
  const r = bdMap.mapDraftToBlueDart(d, {
    service: "D",
    creditReferenceNo: bdMap.creditReference(7699, 1),
    shipper: { customerCode: "099960", originArea: "BOM", pickupTime: "1600", registerPickup: false },
    now,
  });
  const lines = [r.Consignee.ConsigneeAddress1, r.Consignee.ConsigneeAddress2, r.Consignee.ConsigneeAddress3];
  check("address lines are at most 30 chars", lines.every((l) => l.length <= 30), lines.map((l) => l.length).join("/"));
  check("first line keeps the house number", lines[0].startsWith("Flat 12B"), lines[0]);
  check("no line breaks a word", lines.every((l) => !l.startsWith(" ") && !l.endsWith(" ")));
  check("consignee pincode and mobile", r.Consignee.ConsigneePincode === "395006" && r.Consignee.ConsigneeMobile === "9876543210");
  check("shipper from settings", r.Shipper.CustomerCode === "099960" && r.Shipper.OriginArea === "BOM" && r.Shipper.CustomerPincode === "400008");
  check("shipper name prefers the company", r.Shipper.CustomerName === "Haze Studios");
  check("return address falls back to pickup", r.Returnadds.ReturnPincode === "400008" && r.Returnadds.ReturnMobile === "9876500000");
  check("COD sub-product with collectable", r.Services.SubProductCode === "C" && r.Services.CollectableAmount === 1499);
  check("declared value", r.Services.DeclaredValue === 1499);
  check("non-document product type", r.Services.ProductType === 1);
  check("weight as a 2dp string", r.Services.ActualWeight === "0.50");
  check("dimensions with count", r.Services.Dimensions[0].Length === 30 && r.Services.Dimensions[0].Count === 1);
  check("credit reference HZ<order>", r.Services.CreditReferenceNo === "HZ7699");
  check("re-booking gets a distinct reference", bdMap.creditReference(7699, 2) === "HZ7699R2");
  check("reference stays within 20 alphanumerics", /^[A-Za-z0-9]{1,20}$/.test(bdMap.creditReference(123456789012345, 12)));
  check("pickup date is /Date(ms)/", /^\/Date\(\d+\)\/$/.test(r.Services.PickupDate), r.Services.PickupDate);
  check("pickup today before the cutoff", r.Services.PickupDate === `/Date(${now.getTime()})/`);
  check("PDF requested", r.Services.PDFOutputNotRequired === false);
  check("items listed for e-tailing", r.Services.itemdtl.length === 2 && r.Services.itemdtl[1].Itemquantity === 2 && r.Services.itemdtl[1].ItemValue === 500);

  const late = bdMap.pickupDate(new Date("2026-09-21T12:00:00Z"), "1600"); // 17:30 IST
  check("pickup rolls to tomorrow after the cutoff", late.toISOString().startsWith("2026-09-22"), late.toISOString());

  const prepaid = bdMap.mapDraftToBlueDart(draftMod.buildShipmentDraft({ order: { ...order, payment_status: "paid" }, items, settings }), {
    service: "E",
    creditReferenceNo: "HZ7699",
    shipper: { customerCode: "099960", originArea: "BOM", pickupTime: "1600", registerPickup: true },
    now,
  });
  check("prepaid sub-product with zero collectable", prepaid.Services.SubProductCode === "P" && prepaid.Services.CollectableAmount === 0);
  check("register pickup passes through", prepaid.Services.RegisterPickup === true && prepaid.Services.ProductCode === "E");

  const [l1, l2, l3] = bdMap.addressLines({ address1: "A".repeat(70), address2: "", landmark: "" });
  check("a single overlong word is hard-split", l1.length === 30 && l2.length === 30 && l3.length === 10);
}

section("2. DTDC payload");
{
  const d = draftMod.buildShipmentDraft({ order, items, settings });
  const c = dtMap.mapDraftToDtdc(d, {
    service: "B2C SMART EXPRESS",
    customerCode: "GL112",
    commodityId: "99",
    codCollectionMode: "cash",
    attempt: 1,
    now: new Date("2026-09-21T05:00:00Z"),
  });
  check("customer code and service", c.customer_code === "GL112" && c.service_type_id === "B2C SMART EXPRESS");
  check("non-document load in cm/kg", c.load_type === "NON-DOCUMENT" && c.dimension_unit === "cm" && c.weight_unit === "kg" && c.weight === "0.500");
  check("origin from pickup, company as name", c.origin_details.name === "Haze Studios" && c.origin_details.pincode === "400008");
  check("destination from the order", c.destination_details.pincode === "395006" && c.destination_details.phone === "9876543210");
  check("COD amount and collection mode", c.cod_amount === "1499.00" && c.cod_collection_mode === "cash");
  check("declared value", c.declared_value === "1499.00");
  check("reference HZ<order>", c.customer_reference_number === "HZ7699" && c.reference_number === "");
  check("re-booking reference distinct", dtMap.dtdcReference(7699, 2) === "HZ7699R2");
  check("one piece detail for one piece", c.pieces_detail.length === 1 && c.pieces_detail[0].declared_value === "1499.00");
  check("invoice date is an IST date", c.invoice_date === "2026-09-21");

  const prepaid = dtMap.mapDraftToDtdc(draftMod.buildShipmentDraft({ order: { ...order, payment_status: "paid" }, items, settings, pkg: { pieces: 2 } }), {
    service: "B2C PRIORITY", customerCode: "GL112", commodityId: "99", codCollectionMode: "cash", attempt: 1,
  });
  check("prepaid has no COD", prepaid.cod_amount === "0" && prepaid.cod_collection_mode === "");
  check("two pieces split value and weight", prepaid.pieces_detail.length === 2 && prepaid.pieces_detail[0].declared_value === "749.50" && prepaid.num_pieces === "2");
}

section("2. Delhivery payload");
{
  const d = draftMod.buildShipmentDraft({ order, items, settings });
  const m = dlMap.mapDraftToDelhivery(d, {
    service: "Surface",
    pickupLocation: "Haze Studios Mumbai",
    sellerName: "Haze Studios",
    sellerAddress: "14, Industrial Estate, Mumbai, 400008",
    sellerGstin: "27ABCDE1234F1Z5",
    attempt: 1,
    now: new Date("2026-09-21T05:00:00Z"),
  });
  const sh = m.shipments[0];
  check("pickup location is the registered name", m.pickup_location.name === "Haze Studios Mumbai");
  check("consignee fields", sh.name === "Aarav Mehta" && sh.pin === "395006" && sh.phone === "9876543210" && sh.city === "Surat" && sh.state === "Gujarat");
  check("country is a name", sh.country === "India");
  check("order id is the order number", sh.order === "7699");
  check("COD with amount", sh.payment_mode === "COD" && sh.cod_amount === "1499.00");
  check("weight in grams", sh.weight === "500");
  check("dimensions in cm", sh.shipment_length === "30" && sh.shipment_width === "25" && sh.shipment_height === "5");
  check("order date is IST YYYY-MM-DD HH:MM:SS", sh.order_date === "2026-09-21 10:30:00", sh.order_date);
  check("return address falls back to pickup", sh.return_pin === "400008" && sh.return_name === "Haze Studios");
  check("seller GSTIN and invoice", sh.seller_gst_tin === "27ABCDE1234F1Z5" && sh.seller_inv === "HZ7699");
  check("waybill left blank", sh.waybill === "");
  check("shipping mode from the service", sh.shipping_mode === "Surface");
  check("re-booking order id distinct", dlMap.delhiveryOrderId(7699, 2) === "7699-R2");
  check("special characters scrubbed", dlMap.safeText("Sons & Co #4; 50% off\\") === "Sons and Co 4 50 off");

  const amp = dlMap.mapDraftToDelhivery(
    draftMod.buildShipmentDraft({ order: { ...order, payment_status: "paid", shipping_address: { ...order.shipping_address, address1: "12 Park & Lane #3" } }, items, settings }),
    { service: "Express", pickupLocation: "W", sellerName: "", sellerAddress: "", sellerGstin: "", attempt: 1 }
  );
  check("address scrubbed of & and #", amp.shipments[0].add.startsWith("12 Park and Lane 3"), amp.shipments[0].add);
  check("prepaid has zero COD", amp.shipments[0].payment_mode === "Prepaid" && amp.shipments[0].cod_amount === "0");
}

/* -------------------------------------------------------------------------- */
/* 3. Stages                                                                   */
/* -------------------------------------------------------------------------- */

section("3. Stage normalisation");
{
  const n = status.normalizeShipmentStage;
  const sm = [
    ["ORDER_CREATED", "booked"],
    ["PROCESSING", "booked"],
    ["READY_FOR_DISPATCH", "picked_up"],
    ["ARRIVED_AT_HUB", "in_transit"],
    ["IN_TRANSIT", "in_transit"],
    ["OUT_FOR_DELIVERY", "out_for_delivery"],
    ["DELIVERED", "delivered"],
    ["UNDELIVERED", "undelivered"],
    ["RTO_INITIATED", "rto"],
    ["RTO_OUT_FOR_DELIVERY", "rto"],
    ["RTO_DELIVERED", "rto"],
    ["CANCELLED", "cancelled"],
    ["SOMETHING_NEW", "unknown"],
  ];
  for (const [text, stage] of sm) check(`Shree Maruti ${text} → ${stage}`, n("shreemaruti", text) === stage, n("shreemaruti", text));

  const bd = [
    ["SHIPMENT PICKED UP", "picked_up"],
    ["SHIPMENT ARRIVED AT MUMBAI HUB", "in_transit"],
    ["SHIPMENT FURTHER CONNECTED", "in_transit"],
    ["SHIPMENT OUT FOR DELIVERY", "out_for_delivery"],
    ["SHIPMENT DELIVERED", "delivered"],
    ["CONSIGNEE NOT AVAILABLE", "undelivered"],
    ["RETURNED TO SHIPPER", "rto"],
    ["SHIPMENT CANCELLED", "cancelled"],
    ["SOFTDATA UPLOADED", "booked"],
  ];
  for (const [text, stage] of bd) check(`Blue Dart “${text}” → ${stage}`, n("bluedart", text) === stage, n("bluedart", text));
  check("Blue Dart StatusType wins over text", n("bluedart", "SHIPMENT DELIVERED", { statusType: "UD" }) === "undelivered");

  const dl = [
    ["UD", "Manifested", "booked"],
    ["UD", "Not Picked", "booked"],
    ["UD", "In Transit", "in_transit"],
    ["UD", "Pending", "in_transit"],
    ["UD", "Dispatched", "out_for_delivery"],
    ["DL", "Delivered", "delivered"],
    ["RT", "In Transit", "rto"],
    ["RT", "Pending", "rto"],
    ["RT", "Dispatched", "rto"],
    ["DL", "RTO", "rto"],
    ["CN", "Canceled", "cancelled"],
  ];
  for (const [type, text, stage] of dl) check(`Delhivery ${type}/${text} → ${stage}`, n("delhivery", text, { statusType: type }) === stage, n("delhivery", text, { statusType: type }));
  check("Delhivery without a type falls back to text", n("delhivery", "Delivered") === "delivered");

  const dt = [
    ["Booked", "booked"],
    ["Consignment received at facility", "in_transit"],
    ["Bag received at hub", "in_transit"],
    ["In transit", "in_transit"],
    ["Out for delivery", "out_for_delivery"],
    ["Delivered", "delivered"],
    ["Not delivered — consignee not available", "undelivered"],
    ["Return to origin", "rto"],
  ];
  for (const [text, stage] of dt) check(`DTDC “${text}” → ${stage}`, n("dtdc", text) === stage, n("dtdc", text));
  check("no status but an AWB is booked", n("bluedart", "", { hasAwb: true }) === "booked");
  check("no status and no AWB is not booked", n("shreemaruti", null) === "not_booked");

  const alert = status.shipmentAlert;
  const now = new Date("2026-09-21T12:00:00Z");
  check("failed booking is critical", alert({ status: "failed", stage: "not_booked", error: "Bad pincode", stageSince: null, createdAt: "2026-09-21T11:00:00Z", now })?.level === "critical");
  check("booked 3 days ago is critical", alert({ status: "booked", stage: "booked", error: null, stageSince: "2026-09-17T12:00:00Z", createdAt: "2026-09-17T12:00:00Z", now })?.level === "critical");
  check("booked an hour ago is fine", alert({ status: "booked", stage: "booked", error: null, stageSince: "2026-09-21T11:00:00Z", createdAt: "2026-09-21T11:00:00Z", now }) === null);
  check("undelivered warns", alert({ status: "booked", stage: "undelivered", error: null, stageSince: null, createdAt: "2026-09-21T11:00:00Z", now })?.level === "warning");
  check("delivered never alerts", alert({ status: "booked", stage: "delivered", error: null, stageSince: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z", now }) === null);
  check("cancelled never alerts", alert({ status: "cancelled", stage: "cancelled", error: null, stageSince: null, createdAt: "2026-01-01T00:00:00Z", now }) === null);
}

/* -------------------------------------------------------------------------- */
/* 4. Blue Dart responses                                                      */
/* -------------------------------------------------------------------------- */

section("4. Blue Dart response parsing");
{
  const err = bdClient.describeError;
  check("IsError with Status list", err({ GenerateWayBillResult: { IsError: true, Status: [{ StatusCode: "InvalidAreaScNotInRegion", StatusInformation: "Origin area mismatch" }] } }) === "InvalidAreaScNotInRegion: Origin area mismatch");
  check("error-response array", err({ "error-response": [{ IsError: true, Status: [{ StatusInformation: "Waybill already generated" }] }] }) === "Waybill already generated");
  check("gateway fault", err({ fault: { faultstring: "Invalid ApiKey" } }) === "Invalid ApiKey");
  check("success is not an error", err({ GenerateWayBillResult: { IsError: false, AWBNo: "12345678901", Status: [{ StatusInformation: "Valid" }] } }) === null);
  check("HTML page is flattened", err("<html><body><h1>503 Service Unavailable</h1></body></html>") === "503 Service Unavailable");
  check("repeated title and heading collapse", err("<html><head><title>Bad Gateway</title></head><body><h1>Bad Gateway</h1></body></html>") === "Bad Gateway");
  check("different title and heading both kept", err("<html><head><title>Error</title></head><body><h1>Bad Gateway</h1></body></html>") === "Error Bad Gateway");
  check("gateway 401 envelope (seen live)", err({ status: 401, title: "Unauthorized", "error-response": [{ msg: "Access to the method is not allowed." }] }) === "Unauthorized: Access to the method is not allowed.");

  const bytes = bdClient.decodePrintContent([37, 80, 68, 70]);
  check("byte-array label decodes", bytes instanceof Uint8Array && bytes.length === 4 && bytes[0] === 37);
  const b64 = bdClient.decodePrintContent(Buffer.from("%PDF-1.4 minimal label content").toString("base64"));
  check("base64 label decodes", b64 instanceof Uint8Array && Buffer.from(b64).toString().startsWith("%PDF"));
  check("empty label is null", bdClient.decodePrintContent([]) === null && bdClient.decodePrintContent("") === null);

  const tracking = bdClient.parseTracking(
    { ShipmentData: { Shipment: [{ WaybillNo: "12345678901", Status: "SHIPMENT DELIVERED", StatusType: "DL", StatusDate: "21-Sep-2026", StatusTime: "14:05", Scans: { ScanDetail: [{ Scan: "SHIPMENT PICKED UP", ScanDate: "20-Sep-2026", ScanTime: "18:00", ScannedLocation: "MUMBAI" }] } }] } },
    "12345678901"
  );
  check("tracking parses status and scans", tracking?.status === "SHIPMENT DELIVERED" && tracking?.statusType === "DL" && tracking?.scans.length === 1);
  check("tracking with no data is null", bdClient.parseTracking({ ShipmentData: {} }, "x") === null);

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;
  check("JWT expiry decoded", bdClient.jwtExpiryMs(token) === exp * 1000);
  check("non-JWT token has no expiry", bdClient.jwtExpiryMs("not-a-jwt") === null);
}

section("4. Shree Maruti response parsing");
{
  const err = smClient.describeError;
  check("validation error names the field", err({ error: { code: "VALIDATION_ERROR", message: "Request body validation failed.", details: [{ field: "addresses", message: "At least one PICKUP and one DELIVERY address are required." }] } }) === "Request body validation failed. At least one PICKUP and one DELIVERY address are required.");
  check("status:error envelope", err({ status: "error", statusCode: 404, message: "order not found" }) === "order not found");
  check("serviceability errors list", err({ status_code: 400, message: "Invalid request.", errors: { errors: [{ field: "toPincode", message: "toPincode must be a valid 6-digit Indian pincode" }] } })?.includes("toPincode must be"));
  check("success envelope is not an error", err({ status: "success", statusCode: 201, message: "order created successfully", data: { orderId: "x" } }) === null);
  check("serviceability success is not an error", err({ success: true, status_code: 200, message: "Serviceability checked successfully.", data: [] }) === null);
  check("bad API key prefix (seen live)", err({ status_code: 400, message: "Invalid API key prefix. Supported prefixes start with innofulfill_ (new) or prayog_ (legacy).", trace_id: "x" })?.startsWith("Invalid API key prefix"));
  check("HTML 503 flattened (seen live)", err("<html>\r\n<head><title>503 Service Temporarily Unavailable</title></head>\r\n<body>\r\n<center><h1>503 Service Temporarily Unavailable</h1></center>\r\n</body>\r\n</html>") === "503 Service Temporarily Unavailable");
}

section("4. DTDC response parsing");
{
  const err = dtClient.describeError;
  check("wrong api key (seen live)", err({ error: { message: "Wrong api key", statusCode: 401, reason: "WRONG_API_KEY" } }) === "Wrong api key (WRONG_API_KEY)");
  check("tracking unauthorised (seen live)", err({ timestamp: "x", status: 401, error: "Unauthorized", message: "Unauthorized: Authentication token was either missing or invalid.", path: "/x" }) === "Unauthorized: Authentication token was either missing or invalid.");
  check("refused consignment", err({ status: "OK", data: [{ success: false, message: "Pincode not serviceable", customer_reference_number: "HZ1" }] }) === "Pincode not serviceable");
  check("accepted consignment is not an error", err({ status: "OK", data: [{ success: true, reference_number: "D12345678" }] }) === null);
  check("plain text (seen live)", err("Not Authorized") === "Not Authorized");

  const t = dtClient.parseDtdcTracking(
    { statusCode: 200, trackHeader: { strShipmentNo: "D12345678", strStatus: "Delivered", strStatusRelCode: "DLV", strStatusTransOn: "20260921", strStatusTransTime: "1405" },
      trackDetails: [{ strCode: "BKD", strAction: "Booked", strActionDate: "20260920", strActionTime: "1800", strOrigin: "MUMBAI", strDestination: "SURAT", sTrRemarks: "" }] },
    "D12345678"
  );
  check("tracking parses header and scans", t?.status === "Delivered" && t?.statusCode === "DLV" && t?.scans.length === 1 && t?.scans[0].action === "Booked");
  check("tracking with nothing is null", dtClient.parseDtdcTracking({ statusCode: 200 }, "x") === null);
}

section("4. Delhivery response parsing");
{
  const err = dlClient.describeError;
  check("detail envelope (seen live)", err({ detail: "No such user" }) === "No such user");
  check("html login page (seen live)", err("Login or API Key Required") === "Login or API Key Required");
  check("xml detail (seen live)", err("<?xml version=\"1.0\" encoding=\"utf-8\"?><root><detail>Invalid token</detail></root>")?.includes("Invalid token"));
  check("manifest failure with rmk (seen live)", err({ rmk: "Package creation API error.Package might be saved.", error: true, success: false, packages: [] })?.startsWith("Package creation API error"));
  check("manifest package remarks", err({ success: false, packages: [{ status: "Fail", remarks: ["ClientWarehouse matching query does not exist."] }] })?.includes("ClientWarehouse matching query"));
  check("manifest success is not an error", err({ success: true, packages: [{ status: "Success", waybill: "1234567890123", remarks: [] }] }) === null);

  const t = dlClient.parseDelhiveryTracking(
    { ShipmentData: [{ Shipment: { AWB: "1234567890123", Status: { Status: "Dispatched", StatusType: "UD", StatusDateTime: "2026-09-21T10:00:00", StatusLocation: "Surat_Hub (Gujarat)", Instructions: "Out for delivery" },
      Scans: [{ ScanDetail: { Scan: "Manifested", ScanDateTime: "2026-09-20T18:00:00", ScannedLocation: "Mumbai", Instructions: "Manifest uploaded" } }] } }] },
    "1234567890123"
  );
  check("tracking parses status pair and scans", t?.status === "Dispatched" && t?.statusType === "UD" && t?.scans.length === 1 && t?.scans[0].scan === "Manifested");
  check("tracking with nothing is null", dlClient.parseDelhiveryTracking({ ShipmentData: [] }, "x") === null);
  check("pdf link found in json", dlClient.findPdfLink({ packages: [{ pdf_download_link: "https://s3.amazonaws.com/x/label.pdf?sig=1" }] }) === "https://s3.amazonaws.com/x/label.pdf?sig=1");
  check("no pdf link is null", dlClient.findPdfLink({ packages: [{ waybill: "123" }] }) === null);
}

/* -------------------------------------------------------------------------- */
/* 5. Webhook signature                                                        */
/* -------------------------------------------------------------------------- */

section("5. Shree Maruti webhook signature");
{
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", data: { awbNumber: "SFCO0000000550", orderStatus: "DELIVERED" } });
  const ts = new Date().toISOString();
  const hex = createHmac("sha256", secret).update(body).digest("hex");
  const b64 = createHmac("sha256", secret).update(body).digest("base64");
  const v = webhook.verifyShreeMarutiSignature;

  check("hex signature verifies", v(body, ts, hex, secret).ok);
  check("base64 signature verifies", v(body, ts, b64, secret).ok);
  check("sha256= prefix tolerated", v(body, ts, `sha256=${hex}`, secret).ok);
  check("tampered body rejected", !v(body.replace("DELIVERED", "RTO"), ts, hex, secret).ok);
  check("wrong secret rejected", !v(body, ts, hex, "other").ok);
  check("stale timestamp rejected", !v(body, "2020-01-01T00:00:00Z", hex, secret).ok);
  check("missing signature rejected", !v(body, ts, null, secret).ok);
  check("no secret configured rejected", !v(body, ts, hex, "").ok);

  const payload = JSON.parse(body);
  check("idempotency prefers the header", webhook.webhookIdempotencyKey("hdr_9", payload, body) === "hdr_9");
  check("idempotency falls back to payload id", webhook.webhookIdempotencyKey(null, payload, body) === "evt_1");
  check("status event detected from data", webhook.isStatusEvent(payload));
}

/* -------------------------------------------------------------------------- */

console.log();
if (failures) {
  console.log(`\x1b[31m${failures} check${failures === 1 ? "" : "s"} failed\x1b[0m`);
  process.exit(1);
}
console.log("\x1b[32mAll courier checks passed\x1b[0m");
