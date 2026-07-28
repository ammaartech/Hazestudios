#!/usr/bin/env node
/**
 * Command-line half of the product CSV import.
 *
 *   node scripts/import-products.mjs <file.csv> [--no-overwrite] [--dry]
 *
 * The admin dialog is the normal way in. This exists for the cases a dialog is
 * bad at: a first-run catalogue load of several thousand rows, a re-run after
 * fixing an export, or an import from a machine that is not signed in to the
 * admin. It shares `parseShopifyCsv` and `import_products` with the dialog, so
 * it cannot drift from it — the only difference is the transport (a direct
 * Postgres connection here, PostgREST there).
 *
 * `--dry` parses and reports without writing anything.
 *
 * Requires SUPABASE_DB_URL in .env.local, same as the db:* scripts.
 */

import { readFileSync } from "node:fs";
import pg from "pg";
import { dbConfig, describeTarget } from "./db-config.mjs";
import { chunkProducts, parseShopifyCsv } from "../src/lib/product-csv.ts";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const overwrite = !args.includes("--no-overwrite");
const dryRun = args.includes("--dry");

if (!file) {
  console.error("Usage: node scripts/import-products.mjs <file.csv> [--no-overwrite] [--dry]");
  process.exit(1);
}

/* -------------------------------------------------------------------------- */

console.log(c.bold(`\nParsing ${file}`));
const parsed = parseShopifyCsv(readFileSync(file, "utf8"));

console.log(
  `  ${parsed.stats.rows.toLocaleString()} rows → ` +
    `${c.bold(parsed.stats.products.toLocaleString())} products, ` +
    `${parsed.stats.variants.toLocaleString()} variants, ` +
    `${parsed.stats.images.toLocaleString()} images`
);

if (parsed.unknownColumns.length) {
  console.log(
    c.dim(`  ${parsed.unknownColumns.length} unmapped column(s): ${parsed.unknownColumns.join(", ")}`)
  );
}

for (const issue of parsed.errors) {
  console.log(`  ${c.red("✗")} ${issue.where} — ${issue.message}`);
}

// Warnings are grouped: 37 handles normalised the same way is one fact, not 37.
if (parsed.warnings.length) {
  const kinds = new Map();
  for (const w of parsed.warnings) {
    const kind = w.message.replace(/"[^"]*"/g, "…").replace(/\d+/g, "N");
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  console.log(c.yellow(`\n  ${parsed.warnings.length} warning(s):`));
  for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1])) {
    console.log(c.dim(`    ${String(n).padStart(4)} × ${kind}`));
  }
}

if (!parsed.products.length) {
  console.error(c.red("\nNothing to import.\n"));
  process.exit(1);
}

if (dryRun) {
  console.log(c.yellow("\nDry run — nothing was written.\n"));
  process.exit(0);
}

/* -------------------------------------------------------------------------- */

let config;
try {
  config = dbConfig();
} catch (error) {
  console.error(c.red(error.message));
  if (error.help) console.error(`\n${error.help}\n`);
  process.exit(1);
}

const client = new pg.Client(config);
console.log(c.dim(`\n→ ${describeTarget(config)}`));
await client.connect();

// Same chunking as the dialog. There it is about the 1 MB Server Action body;
// here it is about `statement_timeout` — one 845-product call is a single
// statement, and a single statement that runs for three minutes is one that
// gets cancelled.
const chunks = chunkProducts(parsed.products);
console.log(
  `${chunks.length} batch(es) · ${overwrite ? "overwriting" : "skipping"} existing handles\n`
);

const totals = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
const started = Date.now();

try {
  const { rows: runRows } = await client.query(
    `insert into product_imports (filename, total, status)
     values ($1, $2, 'running') returning id`,
    [file.split(/[\\/]/).pop(), parsed.products.length]
  );
  const runId = runRows[0].id;

  let done = 0;
  for (const [i, chunk] of chunks.entries()) {
    const { rows } = await client.query("select public.import_products($1::jsonb) as result", [
      JSON.stringify({ overwrite, products: chunk }),
    ]);
    const r = rows[0].result;

    totals.created += r.created;
    totals.updated += r.updated;
    totals.skipped += r.skipped;
    totals.failed += r.failed;
    totals.errors.push(...r.errors);
    done += chunk.length;

    console.log(
      `  batch ${String(i + 1).padStart(2)}/${chunks.length}  ` +
        `${String(done).padStart(4)}/${parsed.products.length}  ` +
        c.dim(`+${r.created} new, ~${r.updated} updated`) +
        (r.failed ? c.red(`, ${r.failed} failed`) : "")
    );

    await client.query(
      `update product_imports
       set created = $2, updated = $3, skipped = $4, failed = $5, errors = $6::jsonb
       where id = $1`,
      [runId, totals.created, totals.updated, totals.skipped, totals.failed,
       JSON.stringify(totals.errors.slice(0, 50))]
    );
  }

  await client.query(
    `update product_imports
     set status = $2, finished_at = now()
     where id = $1`,
    [runId, totals.failed ? "failed" : "completed"]
  );
} catch (error) {
  console.error(c.red(`\n${error.message}\n`));
  await client.end();
  process.exit(1);
}

await client.end();

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `\n${totals.failed ? c.yellow("Finished with errors") : c.green("Import complete")} in ${seconds}s — ` +
    `${totals.created} created, ${totals.updated} updated, ` +
    `${totals.skipped} skipped, ${totals.failed} failed.\n`
);

for (const e of totals.errors.slice(0, 20)) {
  console.error(`  ${c.red("✗")} ${e.handle} — ${e.message}`);
}
if (totals.errors.length > 20) {
  console.error(c.dim(`  …and ${totals.errors.length - 20} more`));
}

process.exit(totals.failed ? 1 : 0);
