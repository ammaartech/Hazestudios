export type ProductStatus = "draft" | "active" | "archived";
export type CollectionType = "manual" | "smart";
export type PaymentStatus = "pending" | "paid" | "partially_refunded" | "refunded";
export type FulfillmentStatus = "unfulfilled" | "partial" | "fulfilled";
export type DiscountType = "percentage" | "fixed" | "free_shipping" | "bxgy";
export type DiscountStatus = "active" | "scheduled" | "expired" | "disabled";
export type StaffRole = "owner" | "admin" | "staff";

export interface Product {
  id: string;
  title: string;
  description_html: string;
  status: ProductStatus;
  vendor: string;
  product_type: string;
  tags: string[];
  price: number;
  compare_at_price: number | null;
  cost_per_item: number | null;
  sku: string;
  barcode: string;
  track_inventory: boolean;
  has_variants: boolean;
  seo_title: string;
  seo_description: string;
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
  sku: string;
  barcode: string;
  image_id: string | null;
  position: number;
}

export interface CollectionRule {
  field: "tag" | "title" | "vendor" | "product_type" | "price";
  operator: "equals" | "contains" | "starts_with" | "greater_than" | "less_than";
  value: string;
}

export interface Collection {
  id: string;
  title: string;
  handle: string;
  description: string;
  type: CollectionType;
  rules: CollectionRule[];
  image_url: string | null;
  created_at: string;
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
