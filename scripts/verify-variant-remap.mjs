#!/usr/bin/env node
/**
 * Checks that per-variant edits survive a change to the option structure.
 *
 *   node scripts/verify-variant-remap.mjs
 *
 * `remapOverrides` is the one piece of the product editor that can silently
 * destroy an operator's work: overrides are keyed by variant title, and a title
 * is derived data, so reordering two options rewrites every key. A wrong answer
 * here does not throw — it just quietly returns the product to its default
 * price with no indication anything was lost. Hence a test rather than trust.
 *
 * Touches nothing outside this process: the module under test is pure.
 */

import assert from "node:assert/strict";
import { remapOverrides } from "../src/lib/variants.ts";

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

const colour = { key: "k-colour", name: "Colour", values: ["White", "Black"] };
const size = { key: "k-size", name: "Size", values: ["S", "M"] };

console.log("remapOverrides");

check("adds an option: prices fan out to the new combinations", () => {
  const before = { White: { price: "1650" }, Black: { price: "1800" } };
  const after = remapOverrides(before, [colour], [colour, size]);

  assert.equal(after["White / S"].price, "1650");
  assert.equal(after["White / M"].price, "1650");
  assert.equal(after["Black / S"].price, "1800");
  assert.equal(after["Black / M"].price, "1800");
});

check("adds an option: stock does NOT fan out, or 10 becomes 20", () => {
  const before = { White: { price: "1650", inventory: { loc: 10 } } };
  const after = remapOverrides(before, [colour], [colour, size]);

  assert.deepEqual(after["White / S"].inventory, { loc: 10 });
  assert.equal(
    after["White / M"].inventory,
    undefined,
    "the second size must not inherit the first one's shelf count"
  );
  // The price still fans out — it is a setting, not a count.
  assert.equal(after["White / M"].price, "1650");
});

check("reorders options: overrides follow the rewritten titles", () => {
  const before = {
    "White / S": { price: "1650", sku: "WS" },
    "Black / M": { price: "1800", sku: "BM" },
  };
  const after = remapOverrides(before, [colour, size], [size, colour]);

  assert.equal(after["S / White"].sku, "WS");
  assert.equal(after["M / Black"].sku, "BM");
  assert.equal(after["S / White"].price, "1650");
});

check("renames an option: values are untouched, so overrides survive", () => {
  const before = { "White / S": { sku: "WS" } };
  const renamed = { ...colour, name: "Color" };
  const after = remapOverrides(before, [colour, size], [renamed, size]);

  assert.equal(after["White / S"].sku, "WS");
});

check("renames a value: overrides follow through the rename map", () => {
  const before = { "White / S": { sku: "WS" }, "Black / S": { sku: "BS" } };
  const renamed = { ...colour, values: ["Ivory", "Black"] };
  const after = remapOverrides(before, [colour, size], [renamed, size], {
    [colour.key]: { White: "Ivory" },
  });

  assert.equal(after["Ivory / S"].sku, "WS");
  assert.equal(after["Black / S"].sku, "BS");
  assert.equal(after["White / S"], undefined);
});

check("removes an option: survivors collapse onto the remaining axis", () => {
  const before = {
    "White / S": { sku: "WS" },
    "White / M": { sku: "WM" },
    "Black / S": { sku: "BS" },
  };
  const after = remapOverrides(before, [colour, size], [size]);

  // "White / S" and "Black / S" both feed "S"; first wins, deterministically.
  assert.equal(after["S"].sku, "WS");
  assert.equal(after["M"].sku, "WM");
});

check("removes a value: its override goes with it", () => {
  const before = { "White / S": { sku: "WS" }, "Black / S": { sku: "BS" } };
  const narrowed = { ...colour, values: ["White"] };
  const after = remapOverrides(before, [colour, size], [narrowed, size]);

  assert.equal(after["White / S"].sku, "WS");
  assert.equal(after["Black / S"], undefined);
});

check("reorders values: titles are unchanged, nothing moves", () => {
  const before = { "White / S": { sku: "WS" }, "Black / S": { sku: "BS" } };
  const flipped = { ...colour, values: ["Black", "White"] };
  const after = remapOverrides(before, [colour, size], [flipped, size]);

  assert.equal(after["White / S"].sku, "WS");
  assert.equal(after["Black / S"].sku, "BS");
});

check("removing every option clears the overrides", () => {
  const before = { "White / S": { sku: "WS" } };
  assert.deepEqual(remapOverrides(before, [colour, size], []), {});
});

check("a half-typed option contributes nothing", () => {
  const before = { White: { price: "1650" } };
  const blank = { key: "k-new", name: "", values: [] };
  const after = remapOverrides(before, [colour], [colour, blank]);

  assert.equal(after["White"].price, "1650");
});

console.log(
  process.exitCode
    ? "\nremapOverrides has a regression — see the failures above."
    : `\nAll ${passed} checks passed.`
);
