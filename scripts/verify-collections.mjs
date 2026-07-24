#!/usr/bin/env node
/**
 * Checks the collection schema behaviours the admin and storefront rely on.
 *
 *   node scripts/verify-collections.mjs
 *
 * Three things here are easy to get wrong and impossible to see from the UI:
 *
 *   * manual position assignment — the editor writes explicit positions, while
 *     save_product and duplicate_product do not. Both paths have to end up with
 *     a sane order (see 0013).
 *   * the publish gate — an unpublished collection must be invisible to `anon`
 *     through BOTH the collections table and the membership join, or an
 *     unreleased drop leaks its shape.
 *   * the sort_order constraint — the storefront switches on this value, so an
 *     unrecognised one must be rejected at the door.
 *
 * Cleans up after itself; safe to run against a live database.
 */

import { readFileSync } from "node:fs";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { dbConfig } from "./db-config.mjs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
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

const HANDLE = "verify-collection-delete-me";

try {
  await c.query("delete from collections where handle like 'verify-collection%'");

  const { rows: prods } = await c.query(
    "select id, title from products where status = 'active' order by title limit 4"
  );
  if (prods.length < 3) {
    console.log("Need at least 3 active products — aborting.");
    process.exit(1);
  }

  /* ---- manual positions -------------------------------------------------- */
  console.log("\nManual ordering");
  const { rows: [col] } = await c.query(
    `insert into collections (title, handle, type, published_at)
     values ('Verify Collection', $1, 'manual', now()) returning id`,
    [HANDLE]
  );

  // The collection editor's write: explicit positions, in the merchant's order.
  for (const [i, p] of prods.slice(0, 3).entries()) {
    await c.query(
      "insert into product_collections (product_id, collection_id, position) values ($1,$2,$3)",
      [p.id, col.id, i]
    );
  }

  const ordered = await c.query(
    "select product_id, position from product_collections where collection_id = $1 order by position",
    [col.id]
  );
  check(
    "editor's explicit positions are stored verbatim",
    ordered.rows.map((r) => r.position).join(",") === "0,1,2",
    ordered.rows.map((r) => r.position).join(",")
  );

  // The product editor's write: no position at all (what save_product does).
  await c.query(
    "insert into product_collections (product_id, collection_id) values ($1,$2)",
    [prods[3]?.id ?? prods[0].id, col.id]
  );

  const appended = await c.query(
    "select position from product_collections where collection_id = $1 order by position",
    [col.id]
  );
  check(
    "a membership with no position is appended, not put first",
    appended.rows.at(-1).position === 3,
    `positions ${appended.rows.map((r) => r.position).join(",")}`
  );
  check(
    "no two members share a position",
    new Set(appended.rows.map((r) => r.position)).size === appended.rows.length
  );

  /* ---- sort_order constraint --------------------------------------------- */
  console.log("\nsort_order constraint");
  // Autocommit: a rejected statement stands alone, so no savepoint is needed
  // to keep going after one.
  for (const value of ["manual", "price_asc", "created_desc"]) {
    try {
      await c.query("update collections set sort_order = $1 where id = $2", [
        value,
        col.id,
      ]);
      check(`accepts "${value}"`, true);
    } catch (e) {
      check(`accepts "${value}"`, false, e.code);
    }
  }
  try {
    await c.query("update collections set sort_order = 'best_selling' where id = $1", [
      col.id,
    ]);
    check("rejects an unsupported sort", false, "accepted it");
  } catch (e) {
    check("rejects an unsupported sort", e.code === "23514", e.code);
  }

  /* ---- updated_at --------------------------------------------------------- */
  console.log("\nupdated_at");
  const before = (
    await c.query("select updated_at from collections where id = $1", [col.id])
  ).rows[0].updated_at;
  await new Promise((r) => setTimeout(r, 60));
  await c.query("update collections set title = 'Verify Collection 2' where id = $1", [
    col.id,
  ]);
  const after = (
    await c.query("select updated_at from collections where id = $1", [col.id])
  ).rows[0].updated_at;
  check("moves on edit", after > before);

  /* ---- publish gate ------------------------------------------------------- */
  console.log("\nPublish gate (anon key)");
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const readable = async () => {
    const { data } = await anon.from("collections").select("id").eq("id", col.id);
    return (data ?? []).length > 0;
  };
  const membersReadable = async () => {
    const { data } = await anon
      .from("product_collections")
      .select("product_id")
      .eq("collection_id", col.id);
    return (data ?? []).length > 0;
  };

  check("published collection is readable", await readable());
  check("its memberships are readable", await membersReadable());

  await c.query("update collections set published_at = null where id = $1", [col.id]);
  check("unpublished collection is hidden", !(await readable()));
  check("its memberships are hidden too", !(await membersReadable()));

  // A future publish date must not be live yet.
  await c.query(
    "update collections set published_at = now() + interval '1 day' where id = $1",
    [col.id]
  );
  check("a future publish date is not yet live", !(await readable()));

  await c.query("update collections set published_at = now() where id = $1", [col.id]);
  check("re-publishing restores it", await readable());

  /* ---- anon cannot write -------------------------------------------------- */
  console.log("\nAnon write attempts");
  const { error: insErr } = await anon
    .from("collections")
    .insert({ title: "forged", handle: "verify-collection-forged" });
  check("anon cannot create a collection", Boolean(insErr), insErr?.code ?? "no error");

  const { data: updated } = await anon
    .from("collections")
    .update({ title: "hijacked" })
    .eq("id", col.id)
    .select("id");
  check("anon cannot edit a collection", (updated ?? []).length === 0);
} finally {
  await c.query("delete from collections where handle like 'verify-collection%'");
  const { rows } = await c.query(
    "select count(*)::int n from collections where handle like 'verify-collection%'"
  );
  console.log(`\nCleaned up: ${rows[0].n === 0}`);
  await c.end();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
