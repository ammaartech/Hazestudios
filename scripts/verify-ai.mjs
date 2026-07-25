#!/usr/bin/env node
/**
 * Exercises the real Gemini classifier against live product photos.
 *
 *   node scripts/verify-ai.mjs
 *
 * Imports the actual src/lib/ai/gemini.ts module (not an ad-hoc request), so it
 * proves the production code path — image fetch, base64 inlining, the request
 * shape, and JSON parsing. Skips cleanly when GEMINI_API_KEY is unset, so it is
 * safe to run anywhere.
 *
 * Reads a couple of real uploaded product images from the database and prints
 * what the model proposes, asserting the response is well-formed.
 */
import pg from "pg";
import { dbConfig, loadEnv } from "./db-config.mjs";
import { classifyProductImages, geminiConfigured } from "../src/lib/ai/gemini.ts";

// The shared reader rather than an inline one: it strips the surrounding quotes
// that SUPABASE_DB_URL needs when the password contains a '#' or a '$', and it
// resolves .env.local relative to the repo instead of the current directory.
loadEnv();

if (!geminiConfigured()) {
  console.log("GEMINI_API_KEY not set — skipping (this is fine).");
  process.exit(0);
}

const c = new pg.Client(dbConfig());
await c.connect();

let pass = 0;
let fail = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (ok) pass++;
  else fail++;
};

try {
  // Prefer real uploads (Supabase storage) over seed placeholders.
  const { rows } = await c.query(`
    select pi.url, p.title
      from product_images pi
      join products p on p.id = pi.product_id
     where pi.url like '%supabase%'
     order by pi.position
     limit 2`);

  if (!rows.length) {
    console.log("No uploaded product images to test with — skipping.");
    process.exit(0);
  }

  for (const row of rows) {
    const result = await classifyProductImages([row.url], {
      existingCategories: ["Tops", "Outerwear", "Knitwear", "Accessories"],
      existingTypes: ["T-shirt", "Hoodie", "Jacket"],
    });

    console.log(`\n${row.title}`);
    check("returns a classification", result !== null);
    if (result) {
      console.log(
        `    → category: "${result.category}"  type: "${result.productType}"  confidence: ${result.confidence}`
      );
      check("category is non-empty", result.category.length > 0);
      check("productType is non-empty", result.productType.length > 0);
      check(
        "confidence is a valid level",
        ["high", "medium", "low"].includes(result.confidence)
      );
    }
  }

  // A bad URL must degrade to null, not throw.
  const bad = await classifyProductImages(["https://example.invalid/nope.jpg"]);
  console.log("\nUnreachable image");
  check("degrades to null (no throw)", bad === null);
} finally {
  await c.end();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
