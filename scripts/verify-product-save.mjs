#!/usr/bin/env node
/**
 * Smoke test for 0005_product_parity.sql.
 *
 *   node scripts/verify-product-save.mjs
 *
 * This does not check that the SQL parsed — `migrate up` already proved that.
 * It checks that the two data-loss bugs 0005 exists to fix are actually fixed,
 * by exercising the real function against the real database:
 *
 *   1. Image identity survives a re-save, so `product_variants.image_id` keeps
 *      pointing at a row that still exists. (Before: every save deleted and
 *      re-inserted images, silently nulling the FK.)
 *   2. Per-location variant stock survives a re-save. (Before: stock was read
 *      summed across locations and written back to the default one, so
 *      multi-location counts collapsed on every save.)
 *
 * Everything it creates is namespaced and deleted at the end, including on
 * failure. It touches nothing that already existed.
 */

import { randomUUID } from "node:crypto";
import pg from "pg";
import { dbConfig, describeTarget } from "./db-config.mjs";

const TAG = `zz-verify-${Date.now()}`;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ${c.green("✓")} ${label}`);
  } else {
    failures.push({ label, detail });
    console.log(`  ${c.red("✗")} ${label}`);
    if (detail) console.log(`    ${c.dim(detail)}`);
  }
}

/* -------------------------------------------------------------------------- */

async function main() {
  let config;
  try {
    config = dbConfig();
  } catch (error) {
    console.error(c.red(error.message));
    if (error.help) console.error(`\n${error.help}\n`);
    process.exit(1);
  }

  const client = new pg.Client(config);
  console.log(c.dim(`→ ${describeTarget(config)}`));
  await client.connect();

  const created = { products: [], locations: [] };

  try {
    /* ---- fixtures ---------------------------------------------------------- */

    let { rows: locations } = await client.query(
      "select id, name, is_default from locations order by created_at"
    );

    if (locations.length === 0) {
      const { rows } = await client.query(
        `insert into locations (name, is_default) values ($1, true) returning id, name, is_default`,
        [`${TAG}-warehouse-a`]
      );
      created.locations.push(rows[0].id);
      locations = rows;
    }
    if (locations.length === 1) {
      // The stock-collapse bug is only observable across two locations.
      const { rows } = await client.query(
        `insert into locations (name, is_default) values ($1, false) returning id, name, is_default`,
        [`${TAG}-warehouse-b`]
      );
      created.locations.push(rows[0].id);
      locations = [...locations, rows[0]];
    }

    const [locA, locB] = locations;
    const imageIdOne = randomUUID();
    const imageIdTwo = randomUUID();

    console.log(`\n${c.bold("Fixtures")}`);
    console.log(c.dim(`  locations: ${locA.name} / ${locB.name}`));

    const basePayload = {
      title: `${TAG} Tee`,
      handle: "",
      description_html: "<p>Verification fixture.</p>",
      status: "draft",
      vendor: "Hazestudios",
      product_type: "T-shirt",
      category: "Apparel",
      tags: [TAG, "verification"],
      price: 40,
      compare_at_price: 60,
      cost_per_item: 12,
      sku: "",
      barcode: "",
      track_inventory: true,
      continue_selling: false,
      requires_shipping: true,
      weight: 0.25,
      weight_unit: "kg",
      country_of_origin: "Portugal",
      hs_code: "6109.10",
      seo_title: "",
      seo_description: "",
      published_at: null,
      images: [
        { id: imageIdOne, url: "https://example.test/one.jpg", alt: "front" },
        { id: imageIdTwo, url: "https://example.test/two.jpg", alt: "back" },
      ],
      options: [{ name: "Size", values: ["S", "M", "L"] }],
      variants: ["S", "M", "L"].map((size) => ({
        title: size,
        option1: size,
        option2: null,
        option3: null,
        price: 40,
        compare_at_price: null,
        cost_per_item: 12,
        sku: `${TAG}-${size}`,
        barcode: "",
        weight: 0.25,
        weight_unit: "kg",
        requires_shipping: true,
        track_inventory: true,
        continue_selling: false,
        available: true,
        image_id: null,
        inventory: [
          { location_id: locA.id, quantity: size === "S" ? 5 : 7 },
          { location_id: locB.id, quantity: size === "S" ? 11 : 13 },
        ],
      })),
      inventory: [],
      collection_ids: [],
    };

    /* ---- 1. first save ----------------------------------------------------- */

    console.log(`\n${c.bold("1. Initial save")}`);
    const { rows: saved } = await client.query("select save_product($1::jsonb) as r", [
      JSON.stringify(basePayload),
    ]);
    const productId = saved[0].r.id;
    created.products.push(productId);

    check("save_product returned an id", Boolean(productId));
    check(
      "handle was auto-derived from the title",
      /^zz-verify-\d+-tee$/.test(saved[0].r.handle),
      `got "${saved[0].r.handle}"`
    );

    const rowsOf = async (table, extra = "") =>
      (await client.query(`select * from ${table} where product_id = $1 ${extra}`, [productId]))
        .rows;

    const images1 = await rowsOf("product_images", "order by position");
    const variants1 = await rowsOf("product_variants", "order by position");
    const levels1 = await rowsOf("inventory_levels");

    check("2 images written", images1.length === 2, `got ${images1.length}`);
    check(
      "images kept their client-supplied ids",
      images1[0]?.id === imageIdOne && images1[1]?.id === imageIdTwo
    );
    check("3 variants written", variants1.length === 3, `got ${variants1.length}`);
    check(
      "variant stock written per location (3 variants x 2 locations)",
      levels1.length === 6,
      `got ${levels1.length}`
    );
    check(
      "has_variants was derived, not trusted from the client",
      (await client.query("select has_variants from products where id = $1", [productId]))
        .rows[0].has_variants === true
    );

    /* ---- 2. link a variant to an image, then re-save ------------------------ */

    console.log(`\n${c.bold("2. Re-save — the image-orphaning bug")}`);

    const secondSave = structuredClone(basePayload);
    secondSave.id = productId;
    // Point variant S at the first image, and reorder the images while we're
    // here. The old code would have deleted both image rows and re-inserted
    // them with new ids, nulling this FK.
    secondSave.variants[0].image_id = imageIdOne;
    secondSave.images = [secondSave.images[1], secondSave.images[0]];

    await client.query("select save_product($1::jsonb)", [JSON.stringify(secondSave)]);

    const images2 = await rowsOf("product_images", "order by position");
    const variants2 = await rowsOf("product_variants", "order by position");
    const variantS = variants2.find((v) => v.title === "S");

    check(
      "image ids survived the re-save",
      images2.length === 2 && images2.every((i) => [imageIdOne, imageIdTwo].includes(i.id)),
      `got ${images2.map((i) => i.id).join(", ")}`
    );
    check(
      "reorder persisted (image two is now position 0)",
      images2[0]?.id === imageIdTwo
    );
    check(
      "variant.image_id still resolves to a live image row",
      variantS?.image_id === imageIdOne,
      `image_id = ${variantS?.image_id ?? "NULL"} — this is the exact FK the old save nulled`
    );

    /* ---- 3. per-location stock --------------------------------------------- */

    console.log(`\n${c.bold("3. Re-save — the stock-collapse bug")}`);

    const levels2 = await rowsOf("inventory_levels");
    const stockFor = (title, locId) => {
      const variant = variants2.find((v) => v.title === title);
      return levels2.find((l) => l.variant_id === variant?.id && l.location_id === locId)
        ?.quantity;
    };

    check("variant S still holds 5 at location A", stockFor("S", locA.id) === 5,
      `got ${stockFor("S", locA.id)}`);
    check("variant S still holds 11 at location B", stockFor("S", locB.id) === 11,
      `got ${stockFor("S", locB.id)} — old code summed to 16 and wrote it all to the default`);
    check("variant M still holds 7 / 13 across A / B",
      stockFor("M", locA.id) === 7 && stockFor("M", locB.id) === 13);
    check("no stock rows leaked", levels2.length === 6, `got ${levels2.length}`);

    /* ---- 4. dropping a variant --------------------------------------------- */

    console.log(`\n${c.bold("4. Dropping an option value")}`);

    const thirdSave = structuredClone(secondSave);
    thirdSave.options = [{ name: "Size", values: ["S", "M"] }];
    thirdSave.variants = thirdSave.variants.filter((v) => v.title !== "L");
    await client.query("select save_product($1::jsonb)", [JSON.stringify(thirdSave)]);

    const variants3 = await rowsOf("product_variants");
    const levels3 = await rowsOf("inventory_levels");
    check("variant L was removed", variants3.length === 2, `got ${variants3.length}`);
    check("its stock rows cascaded away", levels3.length === 4, `got ${levels3.length}`);
    check(
      "surviving variants kept their SKUs",
      variants3.every((v) => v.sku === `${TAG}-${v.title}`)
    );

    /* ---- 5. atomicity ------------------------------------------------------ */

    console.log(`\n${c.bold("5. Atomicity on failure")}`);

    const before = (await client.query("select count(*)::int n from products")).rows[0].n;
    let raised = false;
    try {
      await client.query("select save_product($1::jsonb)", [
        JSON.stringify({ ...basePayload, title: "   " }),
      ]);
    } catch {
      raised = true;
    }
    const after = (await client.query("select count(*)::int n from products")).rows[0].n;

    check("an empty title is rejected", raised);
    check("and left no partial product behind", before === after, `${before} → ${after}`);

    /* ---- 6. duplicate ------------------------------------------------------ */

    console.log(`\n${c.bold("6. duplicate_product")}`);

    const { rows: dup } = await client.query("select duplicate_product($1) as r", [productId]);
    created.products.push(dup[0].r.id);

    const copy = (await client.query("select * from products where id = $1", [dup[0].r.id]))
      .rows[0];
    const copyImages = (
      await client.query("select * from product_images where product_id = $1 order by position", [
        dup[0].r.id,
      ])
    ).rows;
    const copyVariants = (
      await client.query("select * from product_variants where product_id = $1", [dup[0].r.id])
    ).rows;
    const copyLevels = (
      await client.query("select * from inventory_levels where product_id = $1", [dup[0].r.id])
    ).rows;

    check("copy landed as a draft", copy.status === "draft");
    check("copy got its own handle", copy.handle !== saved[0].r.handle, copy.handle);
    check("children were copied", copyImages.length === 2 && copyVariants.length === 2);
    check(
      "copy's variant image_id points at the COPY's image, not the original's",
      copyVariants.find((v) => v.title === "S")?.image_id ===
        copyImages.find((i) => i.url.endsWith("one.jpg"))?.id
    );
    check("stock was NOT copied (two products don't share a shelf)", copyLevels.length === 0);

    /* ---- 7. facets --------------------------------------------------------- */

    console.log(`\n${c.bold("7. product_facets")}`);
    const { rows: facetRows } = await client.query("select product_facets() as f");
    const facets = facetRows[0].f;
    check("returns the four autocomplete lists",
      ["tags", "vendors", "types", "categories"].every((k) => Array.isArray(facets[k])));
    check("tags include the fixture's tag", facets.tags.includes(TAG));
  } finally {
    /* ---- cleanup ----------------------------------------------------------- */
    console.log(`\n${c.bold("Cleanup")}`);
    for (const id of created.products) {
      await client.query("delete from products where id = $1", [id]).catch(() => {});
    }
    for (const id of created.locations) {
      await client.query("delete from locations where id = $1", [id]).catch(() => {});
    }
    console.log(
      c.dim(
        `  removed ${created.products.length} product(s), ${created.locations.length} location(s)`
      )
    );
    await client.end();
  }

  console.log(
    failures.length
      ? c.red(`\n${passed} passed, ${failures.length} FAILED\n`)
      : c.green(`\n${passed} checks passed.\n`)
  );
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(c.red(`\n${error.message}`));
  if (error.detail) console.error(c.dim(error.detail));
  console.error("");
  process.exit(1);
});
