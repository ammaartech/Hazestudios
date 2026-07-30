"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Search endpoints for the order builder.
 *
 * The builder used to receive the whole catalogue as props — 773 products with
 * 4,751 variants (3.1 MB of JSON) plus 3,952 customers (614 KB) — purely to
 * populate two `<select>` elements. Nothing about that scales, and a native
 * select cannot show a thumbnail, a price or a stock count anyway. Searching on
 * the server keeps the page payload flat as the catalogue grows and lets the
 * picker render the columns an operator actually needs to pick the right SKU.
 */

const PRODUCT_LIMIT = 25;
const CUSTOMER_LIMIT = 20;

/**
 * PostgREST parses `,` `(` `)` as filter syntax and `%` as a wildcard, so a
 * query containing them would either error or silently match everything. None
 * carry meaning in a product title search, so they are dropped.
 */
function sanitize(term: string) {
  return term.replace(/[%,()*\\]/g, " ").trim();
}

export interface PickerVariant {
  id: string;
  title: string;
  price: number;
  sku: string | null;
  /** Summed across locations. Null when the product does not track inventory. */
  available: number | null;
}

export interface PickerProduct {
  id: string;
  title: string;
  price: number;
  cover: string | null;
  /** Empty for a single-variant product, which is then selected by itself. */
  variants: PickerVariant[];
  available: number | null;
}

type ProductQueryRow = {
  id: string;
  title: string;
  price: number;
  track_inventory: boolean;
  product_images: { url: string; position: number }[];
  product_variants: { id: string; title: string; price: number; sku: string | null }[];
  inventory_levels: { variant_id: string | null; quantity: number }[];
};

function toPickerProduct(row: ProductQueryRow): PickerProduct {
  // One product can hold stock at several locations; the operator only cares
  // about the total they are allowed to sell.
  const stock = new Map<string | null, number>();
  for (const level of row.inventory_levels) {
    stock.set(
      level.variant_id,
      (stock.get(level.variant_id) ?? 0) + level.quantity
    );
  }

  const cover =
    [...row.product_images].sort((a, b) => a.position - b.position)[0]?.url ??
    null;

  return {
    id: row.id,
    title: row.title,
    price: Number(row.price),
    cover,
    available: row.track_inventory ? stock.get(null) ?? 0 : null,
    variants: row.product_variants.map((v) => ({
      id: v.id,
      title: v.title,
      price: Number(v.price),
      sku: v.sku,
      available: row.track_inventory ? stock.get(v.id) ?? 0 : null,
    })),
  };
}

const PRODUCT_SELECT =
  "id, title, price, track_inventory, product_images(url, position), product_variants(id, title, price, sku), inventory_levels(variant_id, quantity)";

export async function searchOrderProducts(
  term: string
): Promise<PickerProduct[]> {
  const supabase = await createClient();
  const q = sanitize(term);

  const base = () =>
    supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .neq("status", "archived")
      .order("title")
      .limit(PRODUCT_LIMIT);

  // No term yet: show the head of the catalogue so the modal opens with
  // something to click rather than an empty box.
  if (!q) {
    const { data } = await base();
    return ((data ?? []) as ProductQueryRow[]).map(toPickerProduct);
  }

  // Operators frequently have a SKU rather than a title — it is what the
  // courier manifest and the Qikink line both carry. SKU lives on the variant,
  // and PostgREST cannot OR across an embedded table, so it takes its own
  // lookup whose product ids are merged into the title matches.
  const [{ data: byTitle }, { data: bySku }] = await Promise.all([
    base().or(`title.ilike.%${q}%,vendor.ilike.%${q}%`),
    supabase
      .from("product_variants")
      .select("product_id")
      .ilike("sku", `%${q}%`)
      .limit(PRODUCT_LIMIT),
  ]);

  const rows = (byTitle ?? []) as ProductQueryRow[];
  const seen = new Set(rows.map((r) => r.id));
  const skuIds = [
    ...new Set(
      ((bySku ?? []) as { product_id: string | null }[])
        .map((v) => v.product_id)
        .filter((id): id is string => Boolean(id) && !seen.has(id!))
    ),
  ].slice(0, PRODUCT_LIMIT);

  if (skuIds.length) {
    const { data: skuRows } = await supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .in("id", skuIds)
      .neq("status", "archived")
      .order("title");
    rows.push(...((skuRows ?? []) as ProductQueryRow[]));
  }

  return rows.slice(0, PRODUCT_LIMIT).map(toPickerProduct);
}

export interface PickerCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export async function searchOrderCustomers(
  term: string
): Promise<PickerCustomer[]> {
  const supabase = await createClient();
  const q = sanitize(term);

  let query = supabase
    .from("customers")
    .select("id, first_name, last_name, email, phone")
    .order("first_name")
    .limit(CUSTOMER_LIMIT);

  if (q) {
    query = query.or(
      `first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`
    );
  }

  const { data } = await query;
  return ((data ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  }[]).map((c) => ({
    id: c.id,
    // Imported customers are frequently name-less; falling back to the contact
    // keeps the row identifiable instead of rendering as blank space.
    name:
      `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
      c.email ||
      c.phone ||
      "Unnamed customer",
    email: c.email,
    phone: c.phone,
  }));
}
