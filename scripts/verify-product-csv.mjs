#!/usr/bin/env node
/**
 * Checks the Shopify CSV → product mapping.
 *
 *   node scripts/verify-product-csv.mjs
 *
 * Every assertion here is a bug that would otherwise be silent. An import does
 * not throw when it maps a column wrongly — it writes 845 products that look
 * plausible and are subtly wrong, and nobody finds out until a customer is
 * charged the compare-at price or a variant loses its photo. The parser is
 * pure, so this costs nothing to run and touches no database.
 */

import assert from "node:assert/strict";
import {
  chunkProducts,
  imageId,
  parseCsv,
  parseShopifyCsv,
  slugify,
} from "../src/lib/product-csv.ts";

let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    console.error(String(error.message).split("\n").slice(0, 12).join("\n"));
    process.exitCode = 1;
  }
}

/** Builds a CSV from a header list and row objects, quoting everything. */
function csv(header, rows) {
  const line = (cells) =>
    cells.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",");
  return [line(header), ...rows.map((r) => line(header.map((h) => r[h])))].join("\n");
}

const HEADER = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type", "Tags",
  "Published", "Option1 Name", "Option1 Value", "Option1 Linked To",
  "Option2 Name", "Option2 Value", "Variant SKU", "Variant Grams",
  "Variant Inventory Tracker", "Variant Inventory Policy", "Variant Price",
  "Variant Compare At Price", "Variant Requires Shipping", "Variant Taxable",
  "Image Src", "Image Position", "Image Alt Text", "SEO Title", "SEO Description",
  "Badge (product.metafields.custom.badge)", "Google Shopping / Age Group",
  "Variant Image", "Variant Weight Unit", "Cost per item", "Status",
];

/* -------------------------------------------------------------------------- */

console.log("\nparseCsv");

check("keeps commas and newlines inside quoted fields", () => {
  const rows = parseCsv('a,b\n"one, two","line\nbreak"');
  assert.deepEqual(rows, [
    ["a", "b"],
    ["one, two", "line\nbreak"],
  ]);
});

check("unescapes doubled quotes", () => {
  assert.deepEqual(parseCsv('a\n"say ""hi"""'), [["a"], ['say "hi"']]);
});

check("strips the UTF-8 BOM from the first header", () => {
  assert.deepEqual(parseCsv("﻿Handle,Title\nx,y"), [
    ["Handle", "Title"],
    ["x", "y"],
  ]);
});

check("handles CRLF line endings", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

/* -------------------------------------------------------------------------- */

console.log("\nslugify — must agree with public.slugify");

check("underscores become hyphens, not nothing", () => {
  // The whole reason this is not `handleize`: that one deletes them, Postgres
  // replaces them, and the database has the final say on the handle.
  assert.equal(slugify("untitled-jun3_02-05-54"), "untitled-jun3-02-05-54");
});

check("collapses runs and trims separators", () => {
  assert.equal(slugify("  Hello --- World!! "), "hello-world");
});

check("falls back rather than returning empty", () => {
  assert.equal(slugify("!!!"), "product");
});

/* -------------------------------------------------------------------------- */

console.log("\nimageId");

check("is stable for the same handle and url", () => {
  assert.equal(imageId("tee", "https://x/a.png"), imageId("tee", "https://x/a.png"));
});

check("differs across products and across images", () => {
  assert.notEqual(imageId("tee", "https://x/a.png"), imageId("cap", "https://x/a.png"));
  assert.notEqual(imageId("tee", "https://x/a.png"), imageId("tee", "https://x/b.png"));
});

check("is a valid v3 uuid", () => {
  assert.match(
    imageId("tee", "https://x/a.png"),
    /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
});

/* -------------------------------------------------------------------------- */

console.log("\nparseShopifyCsv — product shape");

const tee = parseShopifyCsv(
  csv(HEADER, [
    {
      Handle: "acid_wash tee",
      Title: "Acid Wash Tee",
      "Body (HTML)": "<p>Soft, heavy, <b>boxy</b>.</p>",
      Vendor: "HAZE STUDIOS",
      "Product Category": "Apparel & Accessories > Clothing",
      Type: "HZ-TSHIRTS",
      Tags: "TOPS, streetwear , TOPS",
      Published: "true",
      "Option1 Name": "Size",
      "Option1 Value": "S",
      "Option1 Linked To": "product.metafields.shopify.size",
      "Option2 Name": "Color",
      "Option2 Value": "White",
      "Variant SKU": "AW-S-W",
      "Variant Grams": "400.0",
      "Variant Inventory Tracker": "shopify",
      "Variant Inventory Policy": "continue",
      "Variant Price": "1299.00",
      "Variant Compare At Price": "1799.00",
      "Variant Requires Shipping": "true",
      "Variant Taxable": "false",
      "Image Src": "https://cdn.shopify.com/a.png",
      "Image Position": "1",
      "Image Alt Text": "Front",
      "SEO Title": "Acid Wash Tee",
      "SEO Description": "A tee.",
      "Badge (product.metafields.custom.badge)": "PRE-ORDER",
      "Google Shopping / Age Group": "adult",
      "Variant Image": "https://cdn.shopify.com/b.png",
      "Variant Weight Unit": "kg",
      "Cost per item": "500.00",
      Status: "active",
    },
    {
      Handle: "acid_wash tee",
      "Option1 Value": "M",
      "Option2 Value": "White",
      "Variant SKU": "AW-M-W",
      "Variant Grams": "420.0",
      "Variant Inventory Tracker": "shopify",
      "Variant Inventory Policy": "deny",
      "Variant Price": "1299.00",
      "Variant Requires Shipping": "true",
      "Variant Taxable": "true",
      "Image Src": "https://cdn.shopify.com/b.png",
      "Image Position": "2",
      "Variant Weight Unit": "kg",
    },
    // Image-only trailing row — the majority of a real export.
    {
      Handle: "acid_wash tee",
      "Image Src": "https://cdn.shopify.com/c.png",
      "Image Position": "3",
    },
  ])
);

const p = tee.products[0];

check("one product per handle, whatever the row count", () => {
  assert.equal(tee.products.length, 1);
  assert.equal(tee.stats.rows, 3);
});

check("product-level fields come from the first row that has them", () => {
  assert.equal(p.title, "Acid Wash Tee");
  assert.equal(p.vendor, "HAZE STUDIOS");
  assert.equal(p.product_type, "HZ-TSHIRTS");
  assert.equal(p.description_html, "<p>Soft, heavy, <b>boxy</b>.</p>");
  assert.equal(p.seo_title, "Acid Wash Tee");
  assert.equal(p.seo_description, "A tee.");
});

check("handle is slugified and reported as a warning", () => {
  assert.equal(p.handle, "acid-wash-tee");
  assert.ok(tee.warnings.some((w) => w.message.includes("acid-wash-tee")));
});

check("tags are split, trimmed and de-duplicated", () => {
  assert.deepEqual(p.tags, ["TOPS", "streetwear"]);
});

check("price and compare-at come from the first variant", () => {
  assert.equal(p.price, 1299);
  assert.equal(p.compare_at_price, 1799);
  assert.equal(p.cost_per_item, 500);
});

check("status and published are read separately", () => {
  assert.equal(p.status, "active");
  assert.ok(p.published_at, "active + Published:true should stamp a date");
});

check("grams are converted into the stated unit", () => {
  // 400 g displayed in kg is 0.4 — not 400.
  assert.equal(p.weight, 0.4);
  assert.equal(p.weight_unit, "kg");
  assert.equal(p.variants[1].weight, 0.42);
});

check("inventory policy maps to continue_selling, tracker to track_inventory", () => {
  assert.equal(p.variants[0].continue_selling, true);
  assert.equal(p.variants[1].continue_selling, false);
  assert.equal(p.variants[0].track_inventory, true);
});

check("taxable is per variant and per product", () => {
  assert.equal(p.taxable, false);
  assert.equal(p.variants[0].taxable, false);
  assert.equal(p.variants[1].taxable, true);
});

check("metafield columns fold into one namespaced map", () => {
  assert.equal(p.metafields["custom.badge"], "PRE-ORDER");
  assert.equal(p.metafields["google.age_group"], "adult");
});

check("options keep their order, values, and metaobject link", () => {
  assert.deepEqual(
    p.options.map((o) => o.name),
    ["Size", "Color"]
  );
  assert.deepEqual(p.options[0].values, ["S", "M"]);
  assert.equal(p.options[0].linked_to, "product.metafields.shopify.size");
});

check("variant titles are the option values joined, as the DB keys on", () => {
  assert.deepEqual(
    p.variants.map((v) => v.title),
    ["S / White", "M / White"]
  );
});

check("images are ordered by position, with alt text", () => {
  assert.deepEqual(
    p.images.map((i) => i.url),
    [
      "https://cdn.shopify.com/a.png",
      "https://cdn.shopify.com/b.png",
      "https://cdn.shopify.com/c.png",
    ]
  );
  assert.equal(p.images[0].alt, "Front");
});

check("Variant Image resolves to one of the product's own image rows", () => {
  // The bug this catches: a dangling image_id fails the FK and rolls the whole
  // product back, or silently nulls and the variant loses its photo.
  assert.equal(p.variants[0].image_id, p.images[1].id);
  assert.equal(p.variants[1].image_id, null);
});

/* -------------------------------------------------------------------------- */

console.log("\nparseShopifyCsv — edge cases");

check("'Default Title' collapses to a simple product", () => {
  const r = parseShopifyCsv(
    csv(HEADER, [
      {
        Handle: "sticker",
        Title: "Sticker",
        "Option1 Name": "Title",
        "Option1 Value": "Default Title",
        "Variant Price": "99.00",
        "Variant SKU": "STK",
        Status: "active",
        Published: "true",
      },
    ])
  );
  const s = r.products[0];
  assert.deepEqual(s.options, []);
  assert.deepEqual(s.variants, []);
  assert.equal(s.price, 99);
  assert.equal(s.sku, "STK", "a simple product keeps the variant's SKU");
});

check("an option genuinely named Title with real values is kept", () => {
  const r = parseShopifyCsv(
    csv(HEADER, [
      { Handle: "b", Title: "Book", "Option1 Name": "Title", "Option1 Value": "Vol 1", "Variant Price": "10", Status: "active" },
      { Handle: "b", "Option1 Value": "Vol 2", "Variant Price": "12" },
    ])
  );
  assert.equal(r.products[0].variants.length, 2);
  assert.equal(r.products[0].options[0].name, "Title");
});

check("'Uncategorized' becomes empty, not a category by that name", () => {
  const r = parseShopifyCsv(
    csv(HEADER, [
      { Handle: "x", Title: "X", "Product Category": "Uncategorized",
        "Option1 Name": "Title", "Option1 Value": "Default Title",
        "Variant Price": "1", Status: "draft" },
    ])
  );
  assert.equal(r.products[0].category, "");
});

check("draft and archived products are never given a publication date", () => {
  const r = parseShopifyCsv(
    csv(HEADER, [
      { Handle: "d", Title: "D", Published: "true", Status: "draft",
        "Option1 Name": "Title", "Option1 Value": "Default Title", "Variant Price": "1" },
    ])
  );
  assert.equal(r.products[0].status, "draft");
  assert.equal(r.products[0].published_at, null);
});

check("an active but unpublished product has no publication date either", () => {
  const r = parseShopifyCsv(
    csv(HEADER, [
      { Handle: "u", Title: "U", Published: "false", Status: "active",
        "Option1 Name": "Title", "Option1 Value": "Default Title", "Variant Price": "1" },
    ])
  );
  assert.equal(r.products[0].published_at, null);
});

check("a partial variant grid imports and warns", () => {
  const r = parseShopifyCsv(
    csv(HEADER, [
      { Handle: "g", Title: "G", "Option1 Name": "Size", "Option1 Value": "S",
        "Option2 Name": "Color", "Option2 Value": "Red", "Variant Price": "1", Status: "active" },
      { Handle: "g", "Option1 Value": "M", "Option2 Value": "Blue", "Variant Price": "1" },
    ])
  );
  // 2 sizes x 2 colours = 4 combinations, only 2 variants present.
  assert.equal(r.products[0].variants.length, 2);
  assert.ok(r.warnings.some((w) => w.message.includes("2 of 4")));
});

check("a row with no handle is an error, not a crash", () => {
  const r = parseShopifyCsv(csv(HEADER, [{ Title: "Orphan", "Variant Price": "1" }]));
  assert.equal(r.products.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /No Handle/);
});

check("a handle with no title anywhere is skipped with a reason", () => {
  const r = parseShopifyCsv(csv(HEADER, [{ Handle: "ghost", "Image Src": "https://x/a.png" }]));
  assert.equal(r.products.length, 0);
  assert.match(r.errors[0].message, /No Title/);
});

check("a non-Shopify CSV is rejected before anything is written", () => {
  const r = parseShopifyCsv("name,price\nThing,10");
  assert.equal(r.products.length, 0);
  assert.match(r.errors[0].message, /Shopify product export/);
});

check("an empty file is rejected", () => {
  assert.equal(parseShopifyCsv("").products.length, 0);
});

check("unmapped columns are reported rather than silently dropped", () => {
  const r = parseShopifyCsv(
    csv([...HEADER, "Price / India"], [
      { Handle: "x", Title: "X", "Option1 Name": "Title", "Option1 Value": "Default Title",
        "Variant Price": "1", Status: "active", "Price / India": "999" },
    ])
  );
  assert.deepEqual(r.unknownColumns, ["Price / India"]);
});

check("the same image listed twice yields one image row", () => {
  const r = parseShopifyCsv(
    csv(HEADER, [
      { Handle: "x", Title: "X", "Option1 Name": "Title", "Option1 Value": "Default Title",
        "Variant Price": "1", Status: "active", "Image Src": "https://x/a.png", "Image Position": "1" },
      { Handle: "x", "Image Src": "https://x/a.png", "Image Position": "2" },
    ])
  );
  assert.equal(r.products[0].images.length, 1);
});

/* -------------------------------------------------------------------------- */

console.log("\nchunkProducts");

check("keeps every product exactly once, in order", () => {
  const products = Array.from({ length: 50 }, (_, i) => ({ handle: `h${i}`, blob: "x".repeat(500) }));
  const chunks = chunkProducts(products, 4000);
  assert.deepEqual(
    chunks.flat().map((p) => p.handle),
    products.map((p) => p.handle)
  );
});

check("stays under the byte budget", () => {
  const products = Array.from({ length: 50 }, (_, i) => ({ handle: `h${i}`, blob: "x".repeat(500) }));
  for (const chunk of chunkProducts(products, 4000)) {
    assert.ok(JSON.stringify(chunk).length <= 4000 + 600, "chunk overshot the budget");
  }
});

check("never drops a product larger than the whole budget", () => {
  // A single 30 KB product must still be sent, not silently skipped.
  const chunks = chunkProducts([{ handle: "big", blob: "x".repeat(50_000) }], 1000);
  assert.equal(chunks.flat().length, 1);
});

console.log(`\n${passed} checks passed.\n`);
