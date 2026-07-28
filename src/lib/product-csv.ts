/**
 * Shopify `products_export.csv` → `save_product` payloads.
 *
 * Pure and dependency-free on purpose: the import dialog parses the file in the
 * browser so the operator gets a preview and an error list before a single byte
 * reaches the database, and `scripts/import-products.mjs` runs the identical
 * code server-side. One parser, one set of rules, no chance of the preview
 * disagreeing with what actually gets written.
 *
 * ===========================================================================
 * THE SHAPE OF THE FILE
 * ===========================================================================
 * A Shopify export is not one row per product. It is one row per *whichever of*
 * (variant, image) still has something left to say, so a product with 6
 * variants and 12 images occupies 12 rows: the first 6 carry both, the last 6
 * carry only an image, and the product-level columns (Title, Vendor, Body) are
 * filled on the first row and blank on every other. Rows for one product are
 * contiguous and joined by `Handle`.
 *
 * So the parser groups by handle, then reads three overlapping row sets out of
 * each group:
 *
 *   product  — the first row that has a Title
 *   variants — rows with an Option1 Value
 *   images   — rows with an Image Src
 *
 * ===========================================================================
 * NORMALISATIONS (each one is also reported as a warning)
 * ===========================================================================
 *   * `Option1 Name: Title` / `Option1 Value: Default Title` on a single-row
 *     product is Shopify's placeholder for "this product has no options". It
 *     becomes a simple product here — no option row, no variant row — because
 *     writing it through would put a literal "Default Title" variant in the
 *     admin's variant table and on the storefront's size selector.
 *   * `Product Category: Uncategorized` is Shopify's placeholder for "unset",
 *     so it becomes the empty string rather than a category literally named
 *     Uncategorized.
 *   * Handles are run through the same slug rules as `public.slugify`, which
 *     turns the underscores Shopify permits into hyphens.
 *   * `Variant Grams` is always grams regardless of `Variant Weight Unit` —
 *     the unit column is a display preference. Converted to the stated unit.
 */

/* -------------------------------------------------------------------------- */
/* RFC 4180                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Hand-rolled rather than `text.split("\n")`: product descriptions are HTML and
 * routinely contain both commas and newlines inside their quotes. A naive split
 * shreds roughly one product in three in this file.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Excel writes a UTF-8 BOM; left in place it becomes part of the first
  // header name and every column lookup after it misses.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (c === "\r") {
      i += 1; // CRLF — the \n does the work
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Deterministic ids                                                           */
/* -------------------------------------------------------------------------- */

/**
 * MD5, needed only to mint stable image ids (see `imageId`). Not a security
 * primitive here — it is a 128-bit content address, and the alternative,
 * `crypto.subtle.digest`, is async and would force the whole parser to be too.
 */
function md5(input: string): string {
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i += 1) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  }

  // UTF-8 encode, then pad to the MD5 block layout.
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i += 1) {
    // 64-bit little-endian length; inputs here are far below 2^32 bits.
    bytes.push(i < 4 ? (bitLen >>> (8 * i)) & 0xff : 0);
  }

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i += 1) {
      const o = chunk + i * 4;
      M[i] = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24);
    }

    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i += 1) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[i])) | 0;
    }

    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  return [a0, b0, c0, d0]
    .map((word) =>
      Array.from({ length: 4 }, (_, i) =>
        ((word >>> (8 * i)) & 0xff).toString(16).padStart(2, "0")
      ).join("")
    )
    .join("");
}

/**
 * A UUIDv3-shaped id derived from the product handle and the image URL.
 *
 * Content-addressed rather than random because `save_product` upserts images on
 * their id and deletes the ones the payload omits. With random ids, re-running
 * an import would delete every image row and insert fresh ones — and since
 * `product_variants.image_id` is `on delete set null`, every variant would
 * quietly lose its photo. Derived ids make a re-import a no-op for unchanged
 * images, which is the whole point of being able to re-import.
 */
export function imageId(handle: string, url: string): string {
  const h = md5(`hazestudios:product-image:${handle}\n${url}`);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `3${h.slice(13, 16)}`, // version 3 — name-based, MD5
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + h.slice(18, 20),
    h.slice(20, 32),
  ].join("-");
}

/**
 * Mirrors `public.slugify` exactly. Not `handleize` from `@/lib/format`: that
 * one *deletes* characters outside `[a-z0-9\s-]`, so "black_white" becomes
 * "blackwhite" there and "black-white" in Postgres. Since the database has the
 * final say on the handle, the preview has to agree with the database.
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "product";
}

/* -------------------------------------------------------------------------- */
/* Payload types — these mirror `save_product(jsonb)` field for field           */
/* -------------------------------------------------------------------------- */

export type WeightUnit = "kg" | "g" | "lb" | "oz";
export type ProductStatus = "draft" | "active" | "archived";

export interface CsvImage {
  id: string;
  url: string;
  alt: string;
}

export interface CsvOption {
  name: string;
  values: string[];
  /** Shopify metaobject reference, e.g. `shopify.color-pattern`. */
  linked_to: string;
}

export interface CsvVariant {
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
  available: boolean;
  image_id: string | null;
  inventory: never[];
}

export interface CsvProduct {
  handle: string;
  title: string;
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
  continue_selling: boolean;
  requires_shipping: boolean;
  taxable: boolean;
  weight: number | null;
  weight_unit: WeightUnit;
  country_of_origin: string;
  hs_code: string;
  seo_title: string;
  seo_description: string;
  published_at: string | null;
  metafields: Record<string, string>;
  images: CsvImage[];
  options: CsvOption[];
  variants: CsvVariant[];
  inventory: never[];
  collection_ids: never[];
  size_chart_enabled: boolean;
  size_chart: null;
}

export interface ImportIssue {
  /** Product handle, or the CSV line number when the row has no handle. */
  where: string;
  message: string;
}

export interface ParseResult {
  products: CsvProduct[];
  /** Rows that could not be turned into a product. */
  errors: ImportIssue[];
  /** Products that imported, with something the operator should know. */
  warnings: ImportIssue[];
  stats: {
    rows: number;
    products: number;
    variants: number;
    images: number;
  };
  /** Columns present in the file that this importer has no mapping for. */
  unknownColumns: string[];
}

/* -------------------------------------------------------------------------- */
/* Column vocabulary                                                           */
/* -------------------------------------------------------------------------- */

/** Columns read directly. Anything here is excluded from `unknownColumns`. */
const MAPPED_COLUMNS = new Set([
  "Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type", "Tags",
  "Published", "Status", "Gift Card",
  "Option1 Name", "Option1 Value", "Option1 Linked To",
  "Option2 Name", "Option2 Value", "Option2 Linked To",
  "Option3 Name", "Option3 Value", "Option3 Linked To",
  "Variant SKU", "Variant Grams", "Variant Inventory Tracker",
  "Variant Inventory Policy", "Variant Fulfillment Service", "Variant Price",
  "Variant Compare At Price", "Variant Requires Shipping", "Variant Taxable",
  "Variant Barcode", "Variant Image", "Variant Weight Unit", "Variant Tax Code",
  "Image Src", "Image Position", "Image Alt Text",
  "SEO Title", "SEO Description", "Cost per item",
  "Unit Price Total Measure", "Unit Price Total Measure Unit",
  "Unit Price Base Measure", "Unit Price Base Measure Unit",
]);

/**
 * `Badge (product.metafields.custom.badge)` → `custom.badge`.
 * `Google Shopping / Gender`                → `google.gender`.
 *
 * Both families are folded into one flat `metafields` map, so the admin shows
 * them side by side and the storefront reads `metafields["custom.badge"]`
 * without caring where Shopify filed it.
 */
function metafieldKey(column: string): string | null {
  const explicit = /\(product\.metafields\.([^)]+)\)\s*$/.exec(column);
  if (explicit) return explicit[1];

  const google = /^Google Shopping \/ (.+)$/.exec(column);
  if (google) {
    return `google.${google[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Field coercion                                                              */
/* -------------------------------------------------------------------------- */

const GRAMS_PER: Record<WeightUnit, number> = {
  g: 1,
  kg: 1000,
  lb: 453.59237,
  oz: 28.349523125,
};

function weightUnit(raw: string): WeightUnit {
  const v = raw.trim().toLowerCase();
  return v === "g" || v === "lb" || v === "oz" ? v : "kg";
}

/** Shopify stores weight in grams and the unit only for display. */
function weightFromGrams(grams: string, unit: WeightUnit): number | null {
  const n = Number.parseFloat(grams);
  if (!Number.isFinite(n) || n === 0) return null;
  // `weight` is numeric(10,3); more precision than that is silently discarded
  // by Postgres anyway, and rounding here keeps the preview honest.
  return Math.round((n / GRAMS_PER[unit]) * 1000) / 1000;
}

function money(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Shopify writes TRUE/true/FALSE; anything unrecognised takes the default. */
function bool(raw: string, fallback: boolean): boolean {
  const v = raw.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

function status(raw: string): ProductStatus {
  const v = raw.trim().toLowerCase();
  return v === "active" || v === "archived" ? v : "draft";
}

/* -------------------------------------------------------------------------- */
/* The parse                                                                   */
/* -------------------------------------------------------------------------- */

export function parseShopifyCsv(text: string): ParseResult {
  const rows = parseCsv(text);
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];

  if (!rows.length) {
    return {
      products: [], errors: [{ where: "file", message: "The file is empty." }],
      warnings: [], stats: { rows: 0, products: 0, variants: 0, images: 0 },
      unknownColumns: [],
    };
  }

  const header = rows[0].map((h) => h.trim());
  const column = new Map(header.map((h, i) => [h, i]));

  if (!column.has("Handle") || !column.has("Title")) {
    return {
      products: [],
      errors: [{
        where: "file",
        message:
          "This does not look like a Shopify product export — it has no Handle " +
          "and Title columns. Export from Shopify with Products → Export → CSV " +
          "for Excel, Numbers, or other spreadsheet programs.",
      }],
      warnings: [], stats: { rows: 0, products: 0, variants: 0, images: 0 },
      unknownColumns: [],
    };
  }

  const metafieldColumns = header
    .map((name, index) => ({ name, index, key: metafieldKey(name) }))
    .filter((c): c is { name: string; index: number; key: string } => c.key !== null);

  const knownMetafields = new Set(metafieldColumns.map((c) => c.name));
  const unknownColumns = header.filter(
    (h) => h !== "" && !MAPPED_COLUMNS.has(h) && !knownMetafields.has(h)
  );

  // Group by handle, keeping first-seen order so the imported catalogue lists
  // in the same order as the spreadsheet.
  const groups = new Map<string, string[][]>();
  const dataRows = rows.slice(1);

  dataRows.forEach((row, i) => {
    // A trailing newline yields a one-element [""] row; not an error.
    if (row.length <= 1 && (row[0] ?? "").trim() === "") return;

    const handle = (row[column.get("Handle")!] ?? "").trim();
    if (!handle) {
      errors.push({
        where: `row ${i + 2}`,
        message: "No Handle — the row cannot be attached to a product.",
      });
      return;
    }
    const existing = groups.get(handle);
    if (existing) existing.push(row);
    else groups.set(handle, [row]);
  });

  const products: CsvProduct[] = [];
  let variantCount = 0;
  let imageCount = 0;
  const now = new Date().toISOString();

  for (const [rawHandle, group] of groups) {
    const cell = (row: string[], name: string) =>
      (row[column.get(name) ?? -1] ?? "").trim();

    /** First non-empty value for a column anywhere in the group. */
    const first = (name: string) => {
      for (const row of group) {
        const v = cell(row, name);
        if (v) return v;
      }
      return "";
    };

    const title = first("Title");
    if (!title) {
      errors.push({
        where: rawHandle,
        message: "No Title on any row for this handle — skipped.",
      });
      continue;
    }

    const handle = slugify(rawHandle);
    if (handle !== rawHandle) {
      warnings.push({
        where: rawHandle,
        message: `Handle normalised to "${handle}" — storefront URLs use it.`,
      });
    }

    /* ---- Images ---------------------------------------------------------- */
    // Ordered by Image Position, which is authoritative: Shopify writes the
    // images in position order already, but a hand-edited file may not.
    const imageRows = group
      .filter((row) => cell(row, "Image Src"))
      .map((row, order) => ({
        url: cell(row, "Image Src"),
        alt: cell(row, "Image Alt Text"),
        position: Number.parseInt(cell(row, "Image Position"), 10) || order + 1,
        order,
      }))
      .sort((a, b) => a.position - b.position || a.order - b.order);

    const images: CsvImage[] = [];
    const idByUrl = new Map<string, string>();
    for (const img of imageRows) {
      if (idByUrl.has(img.url)) continue; // same photo listed twice
      const id = imageId(handle, img.url);
      idByUrl.set(img.url, id);
      images.push({ id, url: img.url, alt: img.alt });
    }

    /* ---- Options and variants -------------------------------------------- */
    const variantRows = group.filter((row) => cell(row, "Option1 Value"));

    const optionNames = [1, 2, 3].map((n) => first(`Option${n} Name`));
    const optionLinks = [1, 2, 3].map((n) => first(`Option${n} Linked To`));

    // Shopify's no-options placeholder. Only treated as such when it really is
    // a lone variant — a product may legitimately name an option "Title".
    const isSimple =
      variantRows.length <= 1 &&
      optionNames[0].toLowerCase() === "title" &&
      cell(variantRows[0] ?? [], "Option1 Value").toLowerCase() === "default title";

    const options: CsvOption[] = [];
    if (!isSimple) {
      for (let n = 0; n < 3; n += 1) {
        if (!optionNames[n]) continue;
        // Values in order of first appearance, which is the order the merchant
        // arranged them in and the order the storefront selector will show.
        const values: string[] = [];
        const seen = new Set<string>();
        for (const row of variantRows) {
          const v = cell(row, `Option${n + 1} Value`);
          if (v && !seen.has(v)) {
            seen.add(v);
            values.push(v);
          }
        }
        if (values.length) {
          options.push({ name: optionNames[n], values, linked_to: optionLinks[n] });
        }
      }
    }

    const variants: CsvVariant[] = isSimple
      ? []
      : variantRows.map((row) => {
          const unit = weightUnit(cell(row, "Variant Weight Unit"));
          const values = options.map((_, n) => cell(row, `Option${n + 1} Value`));
          const variantImage = cell(row, "Variant Image");

          return {
            title: values.filter(Boolean).join(" / "),
            option1: values[0] || null,
            option2: values[1] || null,
            option3: values[2] || null,
            price: money(cell(row, "Variant Price")) ?? 0,
            compare_at_price: money(cell(row, "Variant Compare At Price")),
            cost_per_item: money(cell(row, "Cost per item")),
            sku: cell(row, "Variant SKU"),
            barcode: cell(row, "Variant Barcode"),
            weight: weightFromGrams(cell(row, "Variant Grams"), unit),
            weight_unit: unit,
            requires_shipping: bool(cell(row, "Variant Requires Shipping"), true),
            // Shopify writes the tracking *service* here ("shopify"), and an
            // empty cell means the variant is not tracked at all.
            track_inventory: cell(row, "Variant Inventory Tracker") !== "",
            continue_selling:
              cell(row, "Variant Inventory Policy").toLowerCase() === "continue",
            taxable: bool(cell(row, "Variant Taxable"), true),
            available: true,
            image_id: variantImage ? (idByUrl.get(variantImage) ?? null) : null,
            // The export carries no quantities — Shopify dropped them from the
            // product CSV once stock became per-location. An empty array leaves
            // existing levels untouched rather than zeroing them.
            inventory: [],
          };
        });

    variantCount += variants.length;
    imageCount += images.length;

    // A merchant can delete individual variants in Shopify, leaving fewer than
    // the full grid. The database stores exactly what is here, but the product
    // editor derives variants from the option grid, so opening one of these and
    // saving will fill the gaps back in.
    if (options.length) {
      const grid = options.reduce((n, o) => n * o.values.length, 1);
      if (grid !== variants.length) {
        warnings.push({
          where: handle,
          message:
            `${variants.length} of ${grid} option combinations have variants. ` +
            "Editing this product in the admin will create the missing ones.",
        });
      }
    }

    if (!images.length) {
      warnings.push({ where: handle, message: "No images." });
    }

    /* ---- Product-level fields -------------------------------------------- */
    // Shopify has no product-level price; the admin does. The first variant is
    // the one Shopify itself shows as the product's price.
    const lead = variantRows[0];
    const leadUnit = lead ? weightUnit(cell(lead, "Variant Weight Unit")) : "kg";

    const metafields: Record<string, string> = {};
    for (const mf of metafieldColumns) {
      const value = first(mf.name);
      if (value) metafields[mf.key] = value;
    }

    const productStatus = status(first("Status"));
    const category = first("Product Category");

    products.push({
      handle,
      title,
      description_html: first("Body (HTML)"),
      status: productStatus,
      vendor: first("Vendor"),
      product_type: first("Type"),
      // Shopify's placeholder for "no category chosen".
      category: category === "Uncategorized" ? "" : category,
      tags: [
        ...new Set(
          first("Tags").split(",").map((t) => t.trim()).filter(Boolean)
        ),
      ],
      price: lead ? (money(cell(lead, "Variant Price")) ?? 0) : 0,
      compare_at_price: lead ? money(cell(lead, "Variant Compare At Price")) : null,
      cost_per_item: lead ? money(cell(lead, "Cost per item")) : null,
      sku: lead ? cell(lead, "Variant SKU") : "",
      barcode: lead ? cell(lead, "Variant Barcode") : "",
      track_inventory: lead ? cell(lead, "Variant Inventory Tracker") !== "" : true,
      continue_selling: lead
        ? cell(lead, "Variant Inventory Policy").toLowerCase() === "continue"
        : false,
      requires_shipping: lead ? bool(cell(lead, "Variant Requires Shipping"), true) : true,
      taxable: lead ? bool(cell(lead, "Variant Taxable"), true) : true,
      weight: lead ? weightFromGrams(cell(lead, "Variant Grams"), leadUnit) : null,
      weight_unit: leadUnit,
      country_of_origin: "",
      hs_code: "",
      seo_title: first("SEO Title"),
      seo_description: first("SEO Description"),
      // `Status` is the record's state; `Published` is whether the online store
      // channel carries it. Only both together mean live, and only then does a
      // publication date make sense.
      published_at:
        productStatus === "active" && bool(first("Published"), false) ? now : null,
      metafields,
      images,
      options,
      variants,
      inventory: [],
      collection_ids: [],
      // The export has no size-chart column. Left off rather than defaulted on,
      // so an import never turns on a size guide with nothing in it.
      size_chart_enabled: false,
      size_chart: null,
    });
  }

  return {
    products,
    errors,
    warnings,
    stats: {
      rows: dataRows.length,
      products: products.length,
      variants: variantCount,
      images: imageCount,
    },
    unknownColumns,
  };
}

/* -------------------------------------------------------------------------- */
/* Batching                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Split into chunks that fit inside one Server Action request.
 *
 * Sized by serialized bytes, not by product count: this catalogue ranges from a
 * 400-byte greeting card to a 30 KB tee with 54 variants and 36 photos, so any
 * fixed count is either wasteful or occasionally over the limit. Next.js caps
 * action bodies at 1 MB, and the budget below leaves room for the action's own
 * framing.
 */
export function chunkProducts(
  products: CsvProduct[],
  maxBytes = 500_000
): CsvProduct[][] {
  const chunks: CsvProduct[][] = [];
  let current: CsvProduct[] = [];
  let size = 0;

  for (const product of products) {
    const bytes = JSON.stringify(product).length;
    if (current.length && size + bytes > maxBytes) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(product);
    size += bytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
