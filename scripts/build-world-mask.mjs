#!/usr/bin/env node
/**
 * Bakes a dotted-world-map land mask into src/lib/analytics/world-mask.ts.
 *
 *   node scripts/build-world-mask.mjs
 *
 * Why a build step: the Live View map needs to know which grid cells are land
 * so it can draw a dot there. Doing that at runtime would mean shipping
 * world-atlas (~100KB of TopoJSON) and d3-geo to every admin page load. Instead
 * we resolve it once, here, and commit a ~3KB base64 bitmap. world-atlas,
 * topojson-client and d3-geo stay devDependencies and never reach the bundle.
 *
 * Re-run only if you want to change GRID_W / GRID_H (dot density).
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { feature } from "topojson-client";
import { geoContains } from "d3-geo";

const require = createRequire(import.meta.url);
const topology = require("world-atlas/land-110m.json");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "lib", "analytics", "world-mask.ts");

// 2° cells. Dense enough that continents read clearly at ~900px wide, sparse
// enough that the SVG stays around 4k dots.
const GRID_W = 180;
const GRID_H = 90;

// Antarctica is mostly noise on a visitor map and eats the bottom fifth of the
// canvas, so the grid stops where Shopify's does.
const LAT_MAX = 84;
const LAT_MIN = -60;

const land = feature(topology, topology.objects.land);

const bits = new Uint8Array(GRID_W * GRID_H);
let landCells = 0;

for (let y = 0; y < GRID_H; y++) {
  // Sample the centre of each cell, not its corner.
  const lat = LAT_MAX - ((y + 0.5) / GRID_H) * (LAT_MAX - LAT_MIN);
  for (let x = 0; x < GRID_W; x++) {
    const lon = -180 + ((x + 0.5) / GRID_W) * 360;
    if (geoContains(land, [lon, lat])) {
      bits[y * GRID_W + x] = 1;
      landCells++;
    }
  }
}

// Pack 8 cells per byte, MSB first, then base64. Keeps the committed file small
// and diff-stable.
const bytes = new Uint8Array(Math.ceil(bits.length / 8));
for (let i = 0; i < bits.length; i++) {
  if (bits[i]) bytes[i >> 3] |= 0b1000_0000 >> (i & 7);
}
const packed = Buffer.from(bytes).toString("base64");

const contents = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/build-world-mask.mjs
//
// A ${GRID_W}×${GRID_H} equirectangular land/ocean bitmap derived from Natural Earth
// 110m data (via world-atlas), packed 8 cells per byte and base64 encoded.
// ${landCells} of ${GRID_W * GRID_H} cells are land.

export const GRID_W = ${GRID_W};
export const GRID_H = ${GRID_H};
export const LAT_MAX = ${LAT_MAX};
export const LAT_MIN = ${LAT_MIN};

const PACKED = "${packed}";

let cache: Uint8Array | null = null;

/** Decoded land mask, one byte per cell (1 = land). Decoded once per process. */
export function landMask(): Uint8Array {
  if (cache) return cache;

  const binary = typeof atob === "function"
    ? atob(PACKED)
    : Buffer.from(PACKED, "base64").toString("binary");

  const out = new Uint8Array(GRID_W * GRID_H);
  for (let i = 0; i < out.length; i++) {
    out[i] = (binary.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  }
  cache = out;
  return out;
}

/**
 * Project lon/lat to fractional grid coordinates, so a visitor pin lands in the
 * same space as the dots. Returns null for latitudes outside the drawn band.
 */
export function project(latitude: number, longitude: number) {
  if (latitude > LAT_MAX || latitude < LAT_MIN) return null;
  return {
    x: ((longitude + 180) / 360) * GRID_W,
    y: ((LAT_MAX - latitude) / (LAT_MAX - LAT_MIN)) * GRID_H,
  };
}
`;

writeFileSync(OUT, contents, "utf8");
console.log(
  `world-mask.ts written — ${landCells}/${GRID_W * GRID_H} land cells, ${packed.length} base64 chars`
);
