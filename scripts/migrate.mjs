#!/usr/bin/env node
/**
 * Migration runner for the Supabase Postgres database.
 *
 *   node scripts/migrate.mjs status     # what's applied, what's pending
 *   node scripts/migrate.mjs baseline   # mark applied WITHOUT running (see below)
 *   node scripts/migrate.mjs up         # apply pending migrations
 *   node scripts/migrate.mjs up --dry   # apply, print, then ROLLBACK
 *
 * Why a ledger: 0001–0004 were applied by hand in the Supabase SQL editor, so
 * the database has their effects but no record of them. Running them again
 * would fail on `create type ... already exists`. `baseline` writes the ledger
 * rows for migrations that are already live, so `up` only ever runs what's new.
 *
 * Each migration runs inside its own transaction. A failure rolls that file
 * back whole — no half-applied schema.
 *
 * Requires SUPABASE_DB_URL in .env.local (gitignored). Use the *Session pooler*
 * URI from Project Settings → Database; transaction-mode pooling does not play
 * well with DDL and multi-statement scripts.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { dbConfig, describeTarget } from "./db-config.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

/* -------------------------------------------------------------------------- */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function ensureLedger(client) {
  await client.query(`
    create table if not exists public._migrations (
      name        text primary key,
      applied_at  timestamptz not null default now(),
      baselined   boolean not null default false
    );
  `);
}

async function appliedSet(client) {
  const { rows } = await client.query("select name from public._migrations");
  return new Set(rows.map((r) => r.name));
}

/* -------------------------------------------------------------------------- */

async function main() {
  const command = process.argv[2] ?? "status";
  const dryRun = process.argv.includes("--dry");

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

  try {
    await ensureLedger(client);
    const applied = await appliedSet(client);
    const files = migrationFiles();
    const pending = files.filter((f) => !applied.has(f));

    if (command === "status") {
      console.log(`\n${c.bold("Migrations")}\n`);
      for (const file of files) {
        console.log(
          applied.has(file)
            ? `  ${c.green("✓")} ${file} ${c.dim("applied")}`
            : `  ${c.yellow("•")} ${file} ${c.dim("pending")}`
        );
      }
      console.log(
        `\n${files.length} total · ${applied.size} applied · ${pending.length} pending\n`
      );
      return;
    }

    if (command === "baseline") {
      const names = process.argv.slice(3).filter((a) => !a.startsWith("--"));
      const target = names.length
        ? files.filter((f) => names.some((n) => f.startsWith(n)))
        : [];

      if (!target.length) {
        console.error(
          c.red("baseline needs migration prefixes, e.g. `baseline 0001 0002 0003 0004`")
        );
        console.error(c.dim("It records them as applied WITHOUT executing them."));
        process.exit(1);
      }

      for (const file of target) {
        await client.query(
          `insert into public._migrations (name, baselined) values ($1, true)
           on conflict (name) do nothing`,
          [file]
        );
        console.log(`  ${c.green("✓")} ${file} ${c.dim("recorded as already applied")}`);
      }
      console.log(`\nBaselined ${target.length} migration(s). Nothing was executed.\n`);
      return;
    }

    if (command !== "up") {
      console.error(c.red(`Unknown command: ${command}`));
      console.error("Use: status | baseline <prefix…> | up [--dry]");
      process.exit(1);
    }

    if (!pending.length) {
      console.log(c.green("\nNothing to apply — database is up to date.\n"));
      return;
    }

    console.log(
      `\n${pending.length} pending migration(s)${dryRun ? c.yellow(" — DRY RUN, will roll back") : ""}\n`
    );

    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`  ${file} … `);

      try {
        await client.query("begin");
        // One query() call, not split on semicolons: the simple query protocol
        // hands the whole script to Postgres, which is the only thing that
        // parses $$-quoted function bodies correctly.
        await client.query(sql);
        await client.query(
          "insert into public._migrations (name) values ($1) on conflict (name) do nothing",
          [file]
        );

        if (dryRun) {
          await client.query("rollback");
          console.log(c.yellow("ok (rolled back)"));
        } else {
          await client.query("commit");
          console.log(c.green("applied"));
        }
      } catch (error) {
        await client.query("rollback").catch(() => {});
        console.log(c.red("failed"));
        console.error(`\n${c.red("Rolled back. Nothing from this file was kept.")}\n`);
        console.error(`  ${c.bold("error")}   ${error.message}`);
        if (error.detail) console.error(`  ${c.bold("detail")}  ${error.detail}`);
        if (error.hint) console.error(`  ${c.bold("hint")}    ${error.hint}`);
        if (error.where) console.error(`  ${c.bold("where")}   ${error.where}`);
        if (error.position) {
          // Turn the byte offset into something you can actually navigate to.
          const upto = sql.slice(0, Number(error.position));
          const line = upto.split("\n").length;
          console.error(
            `  ${c.bold("at")}      ${file}:${line}\n` +
              c.dim(`          ${sql.split("\n")[line - 1]?.trim() ?? ""}`)
          );
        }
        console.error("");
        process.exit(1);
      }
    }

    console.log(
      dryRun
        ? c.yellow("\nDry run complete — no changes persisted.\n")
        : c.green("\nAll migrations applied.\n")
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(c.red(`\n${error.message}\n`));
  process.exit(1);
});
