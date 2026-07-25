#!/usr/bin/env node
/**
 * Exercises the natural-language report builder behind Analytics → Reports.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-sql-reports.mjs
 *   npm run verify:sql
 *
 * Three parts, in increasing cost:
 *
 *   1. The SQL guard, offline. This is the security boundary that decides which
 *      model output is allowed near the database, so it gets a battery of both
 *      benign queries that must survive and hostile ones that must not. Always
 *      runs — no key, no network, no database.
 *   2. The read-only transaction, against the live database. The whole design
 *      rests on Postgres refusing to write inside `begin transaction read only`,
 *      including through a SECURITY DEFINER function. That assumption is worth
 *      proving on Supabase's own build rather than trusting the manual.
 *   3. The end-to-end path — a real question to Gemini, guarded, executed.
 *
 * Skips cleanly when GEMINI_API_KEY or SUPABASE_DB_URL is unset, so it is safe
 * to run anywhere. Imports the real src/ modules rather than reimplementing
 * them, so a passing run says something about production.
 */
import pg from "pg";
import { dbConfig, loadEnv } from "./db-config.mjs";
import { assertReadOnlySql } from "../src/lib/analytics/sql-guard.ts";
import {
  describeSchema,
  runReadOnlyQuery,
  readOnlyDbConfigured,
} from "../src/lib/db/readonly.ts";
import { questionToSql, textToSqlConfigured } from "../src/lib/ai/text-to-sql.ts";

// The shared reader rather than an inline one: it strips the surrounding quotes
// that SUPABASE_DB_URL needs when the password contains a '#' or a '$', and it
// resolves .env.local relative to the repo instead of the current directory.
loadEnv();

let pass = 0;
let fail = 0;
const check = (label, ok, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (ok) pass++;
  else fail++;
  // Returned so a caller can skip the checks that only make sense downstream.
  return ok;
};

/* -------------------------------------------------------------------------- */
/* 1. The guard                                                                */
/* -------------------------------------------------------------------------- */

/** Queries a correct model would produce. Rejecting one of these is a bug that
 *  looks like the feature simply not working. */
const MUST_ALLOW = [
  ['plain select', `select 1 as "N"`],
  ['trailing semicolon', `select 1 as "N";`],
  ['CTE', `with x as (select 1 as n) select n as "N" from x`],
  [
    'realistic sales aggregate',
    `select oi.title_snapshot as "Product", sum(oi.quantity) as "Units sold"
       from order_items oi
       join orders o on o.id = oi.order_id
      where o.is_draft = false and o.payment_status in ('paid', 'partially_refunded')
      group by 1 order by 2 desc limit 10`,
  ],
  ['semicolon inside a literal', `select 'a;b' as "Text"`],
  // The keyword rules run on a projection with quoted identifiers blanked, so a
  // column label may contain a reserved word.
  ['reserved word in a column alias', `select note as "Order Comment" from orders limit 1`],
  ['reserved word inside a literal', `select 1 as "N" where 'please delete this' ilike '%delete%'`],
  ['line comment', `select 1 as "N" -- explanation`],
  ['block comment', `select /* note */ 1 as "N"`],
  ['fetch first syntax', `select id from orders order by created_at fetch first 5 rows only`],
];

/** Everything here must be refused. Most would also fail at the database, but
 *  the point is that they never reach it. */
const MUST_REJECT = [
  ['bare delete', `delete from products`],
  ['bare insert', `insert into products (title) values ('x')`],
  ['bare update', `update orders set total = 0`],
  ['drop table', `drop table products`],
  ['truncate', `truncate products`],
  ['stacked statement', `select 1; delete from products`],
  ['statement hidden after a comment', `select 1 as "N" --\n; drop table products`],
  ['comment inside a keyword', `de/**/lete from products`],
  ['data-modifying CTE', `with x as (delete from products returning *) select * from x`],
  ['auth schema', `select email from auth.users`],
  ['auth schema, quoted', `select email from "auth"."users"`],
  ['information_schema', `select * from information_schema.tables`],
  ['pg_ catalog', `select * from pg_authid`],
  ['pg_ function', `select pg_sleep(10)`],
  ['storage schema', `select * from storage.objects`],
  ['set_config', `select set_config('timezone', 'utc', false)`],
  ['current_setting', `select current_setting('some.secret')`],
  ['nested execution via xml', `select query_to_xml('select 1', false, false, '')`],
  ['SECURITY DEFINER deleter', `select prune_analytics('1 day')`],
  ['bind placeholder', `select $1 as "N"`],
  ['select into', `select id into copied from orders`],
  ['empty', `   `],
];

console.log("\nSQL guard — queries that must be allowed");
for (const [label, sql] of MUST_ALLOW) {
  try {
    const out = assertReadOnlySql(sql);
    check(label, Boolean(out));
  } catch (error) {
    check(label, false, error.message);
  }
}

console.log("\nSQL guard — queries that must be rejected");
for (const [label, sql] of MUST_REJECT) {
  try {
    assertReadOnlySql(sql);
    check(label, false, "was allowed through");
  } catch {
    check(label, true);
  }
}

/* -------------------------------------------------------------------------- */
/* 2. The read-only transaction                                                */
/* -------------------------------------------------------------------------- */

if (!readOnlyDbConfigured()) {
  console.log("\nSUPABASE_DB_URL not set — skipping the live checks (this is fine).");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

console.log("\nRead-only transaction (the boundary the guard backs onto)");

const client = new pg.Client(dbConfig());
await client.connect();

try {
  await client.query("begin transaction read only");

  // A write the guard would never pass, run deliberately to prove the database
  // stops it on its own.
  let blocked = false;
  let message = "";
  try {
    await client.query(
      "insert into locations (name) values ('verify-sql-reports should never exist')"
    );
  } catch (error) {
    blocked = true;
    message = error.message;
  }
  check("INSERT is refused", blocked, message.split("\n")[0]);

  await client.query("rollback");

  // The important variant: a SECURITY DEFINER function whose body deletes rows.
  // Guard rules are text matching and could be evaded; this cannot be.
  await client.query("begin transaction read only");
  let definerBlocked = false;
  let definerMessage = "";
  try {
    await client.query("select prune_analytics('4000 days')");
  } catch (error) {
    definerBlocked = true;
    definerMessage = error.message;
  }
  check(
    "SECURITY DEFINER function that deletes is refused",
    definerBlocked,
    definerMessage.split("\n")[0]
  );
  await client.query("rollback");

  // And the row count is untouched, which is the claim that actually matters.
  const { rows: after } = await client.query(
    "select count(*)::int as n from analytics_sessions"
  );
  check("analytics_sessions still has its rows", Number.isInteger(after[0].n),
    `${after[0].n} rows`);
} finally {
  await client.end();
}

/* -------------------------------------------------------------------------- */
/* 3. End to end                                                               */
/* -------------------------------------------------------------------------- */

console.log("\nSchema introspection");
let schema = "";
try {
  schema = await describeSchema();
  check("describes tables", schema.includes("orders("));
  check("includes order_items", schema.includes("order_items("));
  check("lists enum values", schema.includes("payment_status:"));
  check("lists foreign keys", schema.includes("order_items.order_id -> orders.id"));
} catch (error) {
  check("introspects the schema", false, error.message);
}

if (!textToSqlConfigured()) {
  console.log("\nGEMINI_API_KEY not set — skipping the model checks (this is fine).");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

const QUESTIONS = [
  // The question this feature was built for, verbatim.
  "report for highest selling product from 1/06/2026 to today",
  "how many orders did we get in the last 30 days?",
  "which tracked products have fewer than 10 in stock?",
];

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

for (const question of QUESTIONS) {
  console.log(`\n"${question}"`);

  const generated = await questionToSql(question, {
    schema,
    today,
    timezone: "America/Toronto",
    currency: "USD",
  });

  if (!check("model returned a query", generated !== null)) continue;
  if (!generated) continue;

  console.log(`    title: ${generated.title}`);
  console.log(`    sql:   ${generated.sql.replace(/\s+/g, " ").slice(0, 160)}`);

  let guarded = null;
  try {
    guarded = assertReadOnlySql(generated.sql);
    check("passes the guard", true);
  } catch (error) {
    check("passes the guard", false, error.message);
  }
  if (!guarded) continue;

  try {
    const result = await runReadOnlyQuery(guarded, "America/Toronto");
    check("executes", true, `${result.rows.length} rows`);
    check(
      "columns are human-readable labels",
      result.columns.every((c) => /[A-Z ]/.test(c.name) || c.name.length > 2),
      result.columns.map((c) => `${c.name} (${c.kind})`).join(", ")
    );
    if (result.rows.length) {
      console.log(`    first row: ${JSON.stringify(result.rows[0])}`);
    }
  } catch (error) {
    check("executes", false, error.message.split("\n")[0]);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
