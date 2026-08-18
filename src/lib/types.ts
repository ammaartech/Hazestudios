export type ProductStatus = "draft" | "active" | "archived";
export type CollectionType = "manual" | "smart";
export type PaymentStatus =
  | "pending"
  | "paid"
  | "partially_paid"
  | "partially_refunded"
  | "refunded"
  | "voided";
export type FulfillmentStatus =
  | "unfulfilled"
  | "partial"
  | "fulfilled"
  | "restocked";
export type DiscountType = "percentage" | "fixed" | "free_shipping" | "bxgy";
export type DiscountStatus = "active" | "scheduled" | "expired" | "disabled";
export type StaffRole = "owner" | "admin" | "staff";
export type WeightUnit = "kg" | "g" | "lb" | "oz";

export interface Product {
  id: string;
  title: string;
  /** URL slug — unique, auto-derived from title when left blank */
  handle: string;
  description_html: string;
  status: ProductStatus;
  vendor: string;
  product_type: string;
  category: string;
  tags: string[];
  price: number;
  compare_at_price: number | null;
  cost_per_item: number | null;
  sku: string;
  barcode: string;
  track_inventory: boolean;
  /** allow orders past zero stock */
  continue_selling: boolean;
  requires_shipping: boolean;
  /** Charge tax on this product at checkout. */
  taxable: boolean;
  weight: number | null;
  weight_unit: WeightUnit;
  country_of_origin: string;
  hs_code: string;
  has_variants: boolean;
  seo_title: string;
  seo_description: string;
  published_at: string | null;
  /** Shows the size guide on the storefront product page. */
  size_chart_enabled: boolean;
  /** Free-form jsonb — run it through `parseSizeChart` before use. */
  size_chart: unknown;
  /**
   * Namespaced custom fields, flat: `{ "custom.badge": "PRE-ORDER" }`.
   * Populated by the CSV import from Shopify's metafield columns and editable
   * in the product editor's Metafields card.
   */
  metafields: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  id: string;
  product_id: string;
  url: string;
  alt: string;
  position: number;
}

export interface ProductOption {
  id: string;
  product_id: string;
  name: string;
  values: string[];
  position: number;
  /**
   * Shopify metaobject this option's values are drawn from, e.g.
   * `product.metafields.shopify.color-pattern`. Empty for a plain text option.
   * Carried through imports so a swatch source is not lost on a round trip.
   */
  linked_to: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price: number;
  compare_at_price: number | null;
  cost_per_item: number | null;
  sku: string;
  barcode: string;
  weight: number | null;
  weight_unit: WeightUnit;
  requires_shipping: boolean;
  track_inventory: boolean;
  continue_selling: boolean;
  taxable: boolean;
  /** unchecked in the variants table = not sold, but kept for later */
  available: boolean;
  image_id: string | null;
  position: number;
}

export interface CollectionRule {
  field: "tag" | "title" | "vendor" | "product_type" | "price";
  operator: "equals" | "contains" | "starts_with" | "greater_than" | "less_than";
  value: string;
}

/** How a collection's products are ordered on the storefront. */
export type CollectionSort =
  | "manual"
  | "alpha_asc"
  | "alpha_desc"
  | "price_asc"
  | "price_desc"
  | "created_desc"
  | "created_asc";

export interface Collection {
  id: string;
  title: string;
  handle: string;
  description: string;
  type: CollectionType;
  rules: CollectionRule[];
  /** Drives the home hero, the collection hero and the editorial tiles. */
  image_url: string | null;
  seo_title: string;
  seo_description: string;
  /** Only `manual` consults product_collections.position. */
  sort_order: CollectionSort;
  /** Null = staged but not live. See 0012_collection_parity.sql. */
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  name: string;
  address: Record<string, string>;
  is_default: boolean;
  created_at: string;
}

export interface InventoryLevel {
  id: string;
  product_id: string;
  variant_id: string | null;
  location_id: string;
  quantity: number;
}

export interface Customer {
  id: string;
  /** Linked auth account; null for guest and imported records. */
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  notes: string;
  tags: string[];
  default_address: Record<string, string>;
  accepts_marketing: boolean;
  total_spent: number;
  orders_count: number;
  created_at: string;
}

export interface SegmentFilter {
  field: "total_spent" | "orders_count" | "country" | "accepts_marketing" | "tag";
  operator: "equals" | "greater_than" | "less_than" | "contains";
  value: string;
}

export interface Segment {
  id: string;
  name: string;
  filters: SegmentFilter[];
  created_at: string;
}

export interface Order {
  id: string;
  order_number: number;
  customer_id: string | null;
  is_draft: boolean;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  subtotal: number;
  discount_total: number;
  discount_code: string | null;
  total: number;
  currency: string;
  note: string;
  location_id: string | null;
  created_at: string;
  closed_at: string | null;

  /* Added in 0014_checkout.sql. Denormalised onto the order rather than read
     through customer_id, because an order is a contract: it has to keep saying
     where it was going after the customer edits their profile. */
  email: string;
  phone: string;
  shipping_address: Record<string, string>;
  /** Empty object means "same as shipping". */
  billing_address: Record<string, string>;
  shipping_total: number;
  tax_total: number;
  payment_method: string;
  /* Added in 0022_payment_pricing.sql. What the payment method itself cost or
     saved, kept apart from shipping_total and discount_total so a report can
     still tell a coupon from a prepaid incentive. Zero on every order placed
     before that migration, and exactly one of the two is ever non-zero. */
  cod_fee: number;
  prepaid_discount: number;
  /** Bearer token for the storefront order status page; null on admin orders. */
  checkout_token: string | null;
  source: string;

  /* Marketing capture — consent and attribution as facts about this purchase. */
  marketing_opt_in: boolean;
  utm: Record<string, string>;
  referrer: string;
  landing_path: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  title_snapshot: string;
  variant_snapshot: string;
  price_snapshot: number;
  quantity: number;
}

export interface Fulfillment {
  id: string;
  order_id: string;
  tracking_number: string;
  carrier: string;
  status: string;
  created_at: string;
}

export interface Refund {
  id: string;
  order_id: string;
  amount: number;
  reason: string;
  restock: boolean;
  created_at: string;
}

export interface Discount {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  min_purchase: number | null;
  usage_limit: number | null;
  used_count: number;
  once_per_customer: boolean;
  starts_at: string;
  ends_at: string | null;
  status: DiscountStatus;
  created_at: string;
}

export interface GiftCard {
  id: string;
  code: string;
  initial_value: number;
  balance: number;
  customer_id: string | null;
  note: string;
  expires_at: string | null;
  disabled_at: string | null;
  created_at: string;
}

export interface FileRecord {
  id: string;
  url: string;
  filename: string;
  mime_type: string;
  size: number;
  created_at: string;
}

/**
 * A row of `waitlist_entries` (0024_waitlist.sql).
 *
 * `position` is a `bigint` identity column. PostgREST hands bigints back as
 * JavaScript numbers, which is safe here — the sequence starts at 139 and this
 * is one event, not an audit log.
 */
export interface WaitlistEntry {
  id: string;
  position: number;
  /** What they asked to be called. Empty on rows written before 0025. */
  name: string;
  email: string;
  phone: string;
  /** Stored without the leading '@'; empty when they did not give one. */
  instagram: string;
  craft: string;
  /** Free text, and only ever set when `craft` is 'other'. */
  craft_note: string;
  status: WaitlistStatus;
  notes: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export type WaitlistStatus = "waiting" | "invited" | "confirmed" | "declined";

export interface StaffMember {
  user_id: string;
  role: StaffRole;
  permissions: Record<string, boolean>;
  display_name: string | null;
  created_at: string;
}

export interface ShopSettings {
  id: number;
  store_name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
  timezone: string;
  address: Record<string, string>;
  brand: { logo_url?: string; primary_color?: string; secondary_color?: string; slogan?: string };
  policies: { privacy?: string; refund?: string; shipping?: string; terms?: string };
  updated_at: string;
}
