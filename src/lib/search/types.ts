import { field, type Field } from "./fuzzy";

/**
 * Shared shapes for the admin's global search.
 *
 * The two tiers — the catalogue matched in the browser, and orders/customers
 * matched by `admin_search` in Postgres — produce the same `Result`, so the
 * dropdown renders one list and never has to know which half a row came from.
 */

export type ResultKind =
  | "product"
  | "collection"
  | "order"
  | "customer"
  | "page";

/**
 * Below two characters the remote tier has no useful answer, only cost.
 *
 * Lives here rather than beside `searchRemote` because the client needs it to
 * decide whether to make the request at all, and that module is `server-only`.
 * The binding constraint is the same check inside the SQL function; this one
 * just saves a round trip.
 */
export const MIN_REMOTE_TERM = 2;

/** Group headers, and the order the groups appear in. */
export const GROUP_ORDER: ResultKind[] = [
  "product",
  "order",
  "customer",
  "collection",
  "page",
];

export const GROUP_LABEL: Record<ResultKind, string> = {
  product: "Products",
  order: "Orders",
  customer: "Customers",
  collection: "Collections",
  page: "Go to",
};

/** One row in the dropdown. */
export interface Result {
  kind: ResultKind;
  id: string;
  href: string;
  title: string;
  subtitle?: string | null;
  /** Right-aligned trailing text — a status, an order count. */
  meta?: string | null;
  /** Formatted money, rendered next to `meta`. */
  amount?: number | null;
  image?: string | null;
  /** 0..1, comparable across both tiers. */
  score: number;
  /** Highlight spans over `title`. Empty when the match was on another field. */
  ranges?: [number, number][];
  /** "SKU", "Vendor", "Tag" — set when the match was not on the title. */
  via?: string;
}

/* -------------------------------------------------------------------------- */
/* The browser-side catalogue index                                            */
/* -------------------------------------------------------------------------- */

/**
 * A product as it crosses the wire: a positional tuple, not an object.
 *
 * Keys would repeat eight field names 849 times. The tuple is ~35% smaller
 * before compression and meaningfully smaller after, and this payload is on the
 * path between pressing ⌘K and the search being usable.
 */
export type ProductTuple = [
  id: string,
  title: string,
  vendor: string,
  productType: string,
  tags: string[],
  sku: string,
  status: string,
  cover: string | null,
];

export type CollectionTuple = [
  id: string,
  title: string,
  handle: string,
  type: string,
  image: string | null,
  productCount: number,
];

export interface SearchIndexPayload {
  products: ProductTuple[];
  collections: CollectionTuple[];
  /** Unix ms the index was built, for the stale check on reopen. */
  builtAt: number;
}

/** An indexed item: everything needed to render a row, plus prepared fields. */
export interface IndexedItem {
  kind: ResultKind;
  id: string;
  href: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  image?: string | null;
  fields: Field[];
  /** Added to the raw score before tier scaling — see `matchItem`. */
  boost: number;
}

/*
 * Field weights.
 *
 * These are multipliers on the positional score *within* a tier, never across
 * one — the tier ladder in fuzzy.ts is a strict ordering, so a vendor match can
 * never outrank a title match at a higher tier no matter how these are set.
 * What they decide is the ordering among fields that matched equally well.
 *
 * The values encode how specific each field is as an identifier. A title names
 * one product. A SKU names one variant and is nearly always pasted whole, so it
 * is close behind. A vendor names a hundred and twenty products at once, so a
 * vendor match is a much weaker claim on being *the* answer — which is why
 * typing "FOGSTORES" should not bury a product actually called that.
 */
const W_TITLE = 1;
const W_SKU = 0.9;
const W_HANDLE = 0.75;
const W_TAG = 0.55;
const W_TYPE = 0.5;
const W_VENDOR = 0.45;

/**
 * Status ranking.
 *
 * An archived product is usually not what someone is looking for, but it is not
 * never — so it is demoted, not filtered. Filtering would make the search lie
 * about the catalogue, and "I know it exists, why can't I find it" is a worse
 * failure than one stale row further down the list.
 */
const STATUS_BOOST: Record<string, number> = {
  active: 12,
  draft: 0,
  archived: -60,
};

export function indexProducts(rows: ProductTuple[]): IndexedItem[] {
  const items: IndexedItem[] = [];

  for (const [id, title, vendor, productType, tags, sku, status, cover] of rows) {
    const fields: Field[] = [];
    const push = (f: Field | null) => {
      if (f) fields.push(f);
    };

    push(field(title, W_TITLE, { primary: true }));
    push(field(sku, W_SKU, { label: "SKU" }));
    push(field(vendor, W_VENDOR, { label: "Vendor" }));
    push(field(productType, W_TYPE, { label: "Type" }));
    for (const tag of tags) push(field(tag, W_TAG, { label: "Tag" }));

    if (!fields.length) continue;

    items.push({
      kind: "product",
      id,
      href: `/admin/products/${id}`,
      title,
      subtitle: vendor || productType || null,
      meta: status === "active" ? null : status[0].toUpperCase() + status.slice(1),
      image: cover,
      fields,
      boost: STATUS_BOOST[status] ?? 0,
    });
  }

  return items;
}

export function indexCollections(rows: CollectionTuple[]): IndexedItem[] {
  const items: IndexedItem[] = [];

  for (const [id, title, handle, type, image, productCount] of rows) {
    const fields: Field[] = [];
    const titleField = field(title, W_TITLE, { primary: true });
    if (!titleField) continue;
    fields.push(titleField);
    const handleField = field(handle, W_HANDLE, { label: "Handle" });
    if (handleField) fields.push(handleField);

    items.push({
      kind: "collection",
      id,
      href: `/admin/products/collections/${id}`,
      title,
      subtitle: type === "smart" ? "Automated" : "Manual",
      meta: `${productCount} product${productCount === 1 ? "" : "s"}`,
      image,
      fields,
      // Thirty-three collections against 849 products: without a nudge a
      // collection almost never surfaces, even when it is the better answer to
      // a broad query like "tops".
      boost: 20,
    });
  }

  return items;
}
