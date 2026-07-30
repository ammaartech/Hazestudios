/**
 * Re-encodes the brand art in public/ to WebP, in place, alongside the source.
 *
 * Product photography is handled at request time by the CDN that stores it (see
 * image-loader.ts). This script exists for the other half: the fixed set of
 * marketing stills we ship ourselves. Those are referenced by literal path from
 * the content modules, so the loader passes them straight through — which means
 * whatever is committed here is exactly what a shopper downloads.
 *
 * That mattered: the homepage hero was a 1.79 MB PNG and the haze-studios
 * mobile hero was 3.72 MB, on a page whose whole job is to load fast on a phone
 * during a drop.
 *
 * Idempotent — a source whose .webp is already newer is skipped, so this is
 * safe to re-run or wire into a build.
 *
 *   node scripts/optimize-public-images.mjs [--force] [--dry] [--max <px>]
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.join(process.cwd(), "public");
const SOURCE_EXT = /\.(png|jpe?g)$/i;

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY = args.includes("--dry");
const maxFlag = args.indexOf("--max");
/**
 * Longest-edge cap. 2000px covers a 2x DPR hero on a 1000px-wide layout, which
 * is the widest any of this art is ever painted; beyond that we'd be shipping
 * detail no display resolves.
 */
const MAX_EDGE = maxFlag >= 0 ? Number(args[maxFlag + 1]) : 2000;

/**
 * Assets that are only ever served to a phone don't need the desktop cap. The
 * layouts art-direct these as separate files, so shrinking them costs nothing
 * on the wide breakpoint — it isn't the file that gets requested there.
 */
const MOBILE_HINT = /(^|[-.])(mobile|thumb)([-.]|$)/i;
const MOBILE_MAX_EDGE = 1200;

/** WebP at this quality is visually lossless for photography at these sizes. */
const QUALITY = 80;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function isStale(source, target) {
  if (FORCE) return true;
  if (!fs.existsSync(target)) return true;
  return fs.statSync(source).mtimeMs > fs.statSync(target).mtimeMs;
}

const kb = (bytes) => Math.round(bytes / 1024);
const rel = (file) => path.relative(process.cwd(), file).replace(/\\/g, "/");

if (!fs.existsSync(ROOT)) {
  console.error(`No public/ directory at ${ROOT}`);
  process.exit(1);
}

const sources = walk(ROOT).filter((file) => SOURCE_EXT.test(file)).sort();

let beforeTotal = 0;
let afterTotal = 0;
let written = 0;
let skipped = 0;

for (const source of sources) {
  const target = source.replace(SOURCE_EXT, ".webp");

  if (!isStale(source, target)) {
    skipped += 1;
    continue;
  }

  const meta = await sharp(source).metadata();
  const cap = MOBILE_HINT.test(path.basename(source)) ? MOBILE_MAX_EDGE : MAX_EDGE;
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0);

  const pipeline = sharp(source);
  // `withoutEnlargement` matters: art already under the cap must not be scaled
  // up into a bigger file than it started as.
  if (longest > cap) pipeline.resize({ width: cap, height: cap, fit: "inside", withoutEnlargement: true });

  const buffer = await pipeline.webp({ quality: QUALITY, effort: 6 }).toBuffer();
  const out = await sharp(buffer).metadata();

  const before = fs.statSync(source).size;
  beforeTotal += before;
  afterTotal += buffer.length;
  written += 1;

  const saved = Math.round((1 - buffer.length / before) * 100);
  console.log(
    `${DRY ? "would write" : "wrote"}  ${String(kb(before)).padStart(5)} KB -> ${String(kb(buffer.length)).padStart(4)} KB  ` +
      `(-${String(saved).padStart(2)}%)  ${meta.width}x${meta.height} -> ${out.width}x${out.height}  ${rel(target)}`
  );

  if (!DRY) fs.writeFileSync(target, buffer);
}

if (!written) {
  console.log(`Nothing to do — ${skipped} source image(s) already have a current .webp.`);
} else {
  const saved = beforeTotal ? Math.round((1 - afterTotal / beforeTotal) * 100) : 0;
  console.log(
    `\n${DRY ? "Would convert" : "Converted"} ${written} image(s), ${skipped} already current.\n` +
      `${kb(beforeTotal)} KB -> ${kb(afterTotal)} KB  (-${saved}%)`
  );
  if (!DRY) {
    console.log(
      "\nThe originals are left in place. Point the content modules at the .webp\n" +
        "files, confirm the pages render, then delete the sources."
    );
  }
}
