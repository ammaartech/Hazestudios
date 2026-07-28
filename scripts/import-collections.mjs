#!/usr/bin/env node
/**
 * Creates the storefront's collections and their membership.
 *
 *   node scripts/import-collections.mjs [file.json] [--dry] [--prune]
 *
 * Why this exists separately from the product import: a Shopify *products*
 * export carries no collection column. Nothing in `products_export_1.csv` says
 * which collection a product belongs to, so membership cannot be reconstructed
 * from it — not from tags either, since the live collections are largely manual
 * and their names do not match any tag in the export.
 *
 * The membership in `scripts/data/fogstores-collections.json` was therefore
 * read off the live storefront's `/collections/<handle>/products.json`, which
 * lists each collection's products in the order the storefront shows them. That
 * order is preserved here as `product_collections.position`.
 *
 * Run this *after* `npm run import:products` — a membership row needs a product
 * to point at, and products missing from the catalogue are reported, not
 * invented.
 *
 * `--dry` reports what would change without writing.
 * `--prune` also removes memberships that are not in the file, making the
 * database match it exactly. Off by default so a partial file cannot silently
 * empty a collection.
 * `--draft` creates the collections unpublished. The default is to publish,
 * because everything in the file is already live on the source storefront and
 * an unpublished collection is invisible to the shop — RLS hides the row *and*
 * its memberships, so the menu silently loses the entry.
 *
 * Requires SUPABASE_DB_URL in .env.local, same as the other db:* scripts.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { dbConfig, describeTarget } from "./db-config.mjs";
import { slugify } from "../src/lib/product-csv.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const args = process.argv.slice(2);
const file =
  args.find((a) => !a.startsWith("--")) ??
  join(ROOT, "scripts/data/fogstores-collections.json");
const dryRun = args.includes("--dry");
const prune = args.includes("--prune");
const draft = args.includes("--draft");

/**
 * Handles that exist on the source storefront but should not become collections
 * here. `all` is Shopify's implicit every-product collection rather than an
 * authored one, and `haze-studios` 404s on the source — it is the dead handle
 * the menu used to point at (the live one is `hazestudios`).
 */
const SKIP = new Set(["all", "haze-studios"]);

/** The Shopify files prefix for this store, used to canonicalise image hosts. */
const SHOPIFY_FILES = "https://cdn.shopify.com/s/files/1/0633/6105/6992";

/**
 * Rewrites a storefront-relative image URL onto the canonical CDN host.
 *
 * The membership was read off a `*.shopifypreview.com` session, and that host
 * serves its own `/cdn/shop/…` proxy paths. Storing those would break twice
 * over: the host is not in `next.config.ts`'s `remotePatterns`, so `next/image`
 * throws and the collection page 500s, and the preview session expires anyway.
 * `/cdn/shop/<rest>` maps 1:1 onto `…/s/files/1/<shop>/<rest>`.
 */
function canonicalImage(url) {
  if (!url) return null;
  const proxied = url.match(/^https?:\/\/[^/]+\/cdn\/shop\/(.+)$/i);
  if (proxied) return `${SHOPIFY_FILES}/${proxied[1]}`;
  // Anything still off-CDN would fail the same remotePatterns check, so drop it
  // rather than store a URL that renders as a 500.
  return /^https:\/\/cdn\.shopify\.com\//i.test(url) ? url : null;
}

/* -------------------------------------------------------------------------- */

const data = JSON.parse(readFileSync(file, "utf8"));

/**
 * Shopify allows handles this catalogue cannot keep verbatim — `_` and emoji
 * both survive there but not through `public.slugify`, which the product import
 * applies on the way in. So `untitled-may27_06-02-41` on the storefront is
 * `untitled-may27-06-02-41` in the database. Matching on the raw handle would
 * silently drop those rows, so the same slugify runs here.
 */
const entries = Object.entries(data.membership)
  .filter(([handle, products]) => !SKIP.has(handle) && products.length > 0)
  .map(([handle, products]) => [handle, products.map(slugify)]);

console.log(c.bold(`\n${file}`));
console.log(
  `  ${entries.length} collections · ` +
    `${new Set(entries.flatMap(([, p]) => p)).size} distinct products` +
    (prune ? c.yellow(" · pruning enabled") : "")
);

let config;
try {
  config = dbConfig();
} catch (error) {
  console.error(c.red(`\n${error.message}`));
  if (error.help) console.error(`\n${error.help}\n`);
  process.exit(1);
}

const client = new pg.Client(config);
console.log(c.dim(`\n→ ${describeTarget(config)}\n`));
await client.connect();

const totals = { created: 0, updated: 0, linked: 0, pruned: 0, missing: new Map() };

try {
  await client.query("begin");

  for (const [handle, productHandles] of entries) {
    const meta = data.meta?.[handle] ?? {};
    const title = meta.title?.trim() || handle;

    // `sort_order: manual` is what makes the storefront read the positions
    // written below; any other value would re-sort and lose the source order.
    // `published_at` is what the storefront's RLS policy gates on: null hides
    // the collection and its memberships entirely. On re-run an existing
    // publish state is left alone, so re-importing never silently republishes
    // something an admin deliberately took down.
    const { rows } = await client.query(
      `insert into collections (handle, title, description, type, sort_order, image_url, published_at)
         values ($1, $2, $3, 'manual', 'manual', $4, case when $5::boolean then null else now() end)
       on conflict (handle) do update
         set title = excluded.title,
             description = case
               when collections.description = '' then excluded.description
               else collections.description
             end,
             -- A previously stored preview-host URL is not worth keeping, so
             -- the canonicalised one wins over anything non-CDN already there.
             image_url = case
               when collections.image_url like 'https://cdn.shopify.com/%'
                 then collections.image_url
               else coalesce(excluded.image_url, collections.image_url)
             end,
             published_at = coalesce(collections.published_at, excluded.published_at)
       returning id, (xmax = 0) as inserted`,
      [handle, title, meta.description ?? "", canonicalImage(meta.image), draft]
    );

    const collectionId = rows[0].id;
    if (rows[0].inserted) totals.created++;
    else totals.updated++;

    // One statement rather than a round-trip per product: the handles go down
    // as an array and the join finds the ids, so a 341-product collection is
    // still a single insert.
    const { rows: linked } = await client.query(
      `with ordered as (
         select h.handle, h.ord
           from unnest($2::text[]) with ordinality as h(handle, ord)
       )
       insert into product_collections (collection_id, product_id, position)
       select $1, p.id, ordered.ord - 1
         from ordered
         join products p on p.handle = ordered.handle
       on conflict (product_id, collection_id) do update
         set position = excluded.position
       returning product_id`,
      [collectionId, productHandles]
    );

    totals.linked += linked.length;

    const absent = productHandles.length - linked.length;
    if (absent > 0) totals.missing.set(handle, absent);

    if (prune) {
      const { rowCount } = await client.query(
        `delete from product_collections pc
          using products p
          where pc.collection_id = $1
            and pc.product_id = p.id
            and not (p.handle = any($2::text[]))`,
        [collectionId, productHandles]
      );
      totals.pruned += rowCount;
    }

    console.log(
      `  ${String(linked.length).padStart(4)}/${String(productHandles.length).padEnd(4)} ` +
        `${handle.padEnd(30)} ${c.dim(title)}` +
        (absent > 0 ? c.yellow(`  (${absent} not in catalogue)`) : "")
    );
  }

  if (dryRun) {
    await client.query("rollback");
    console.log(c.yellow("\nDry run — rolled back, nothing was written.\n"));
  } else {
    await client.query("commit");
  }
} catch (error) {
  await client.query("rollback");
  console.error(c.red(`\n${error.message}\n`));
  await client.end();
  process.exit(1);
}

await client.end();

console.log(
  `\n${dryRun ? c.yellow("Would apply") : c.green("Done")} — ` +
    `${totals.created} collections created, ${totals.updated} updated, ` +
    `${totals.linked} memberships written` +
    (prune ? `, ${totals.pruned} pruned` : "")
);

if (totals.missing.size) {
  const total = [...totals.missing.values()].reduce((a, b) => a + b, 0);
  console.log(
    c.yellow(
      `\n${total} membership(s) skipped — those products are not in the catalogue.`
    )
  );
  console.log(
    c.dim("Import the products first, then re-run this to pick them up:\n")
  );
  for (const [handle, n] of [...totals.missing].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(c.dim(`    ${String(n).padStart(4)} × ${handle}`));
  }
}

console.log();
