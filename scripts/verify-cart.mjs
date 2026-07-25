#!/usr/bin/env node
/**
 * Checks the cart's write path against the real database.
 *
 *   node scripts/verify-cart.mjs
 *
 * The cart actions rest on three things a typecheck cannot see: that
 * `.is("variant_id", null)` actually matches a simple product's line, that the
 * partial unique indexes raise 23505 (the code the add path retries on), and
 * that scoping a write by `cart_id` is a real ownership boundary rather than a
 * decoration. The last one is the important one — it is all that stands between
 * a guessed line id and somebody else's bag.
 *
 * Also asserts the negative space in 0011_carts.sql: the anon role must not be
 * able to read, forge or alter a cart, because the whole design assumes the
 * service role is the only writer.
 *
 * Cleans up after itself; safe to run against a live database.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./db-config.mjs";

// The shared reader rather than an inline one: it strips the surrounding quotes
// a value needs when it contains a '#' or a '$', and it resolves .env.local
// relative to the repo instead of the current directory.
loadEnv();

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

let pass = 0, fail = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (ok) pass++;
  else fail++;
};

const TOKEN = "verify_writes_delete_me";

// --- fixtures ---------------------------------------------------------------
const { data: variants } = await admin
  .from("product_variants")
  .select("id, product_id, available")
  .eq("available", true)
  .limit(2);

const { data: prods } = await admin
  .from("products")
  .select("id")
  .eq("status", "active")
  .limit(1);

const V = variants[0];
const V2 = variants[1];
const SIMPLE = prods[0].id;

await admin.from("carts").delete().eq("token", TOKEN);
const { data: cart } = await admin
  .from("carts")
  .insert({ token: TOKEN })
  .select("id, token")
  .single();

check("service role can create a cart", Boolean(cart?.id));

try {
  /* ---- the "already in the bag?" lookup, variant case -------------------- */
  // This is the builder-reuse pattern from addToCart.
  const findVariantLine = () => {
    const q = admin
      .from("cart_items")
      .select("id, quantity")
      .eq("cart_id", cart.id)
      .eq("product_id", V.product_id);
    return q.eq("variant_id", V.id).maybeSingle();
  };

  const findSimpleLine = () => {
    const q = admin
      .from("cart_items")
      .select("id, quantity")
      .eq("cart_id", cart.id)
      .eq("product_id", SIMPLE);
    return q.is("variant_id", null).maybeSingle();
  };

  console.log("\nLookup on an empty cart");
  const { data: none, error: noneErr } = await findVariantLine();
  check("variant lookup returns null, not an error", none === null && !noneErr,
    noneErr?.message ?? "");
  const { data: noneS } = await findSimpleLine();
  check("simple lookup returns null", noneS === null);

  /* ---- first add --------------------------------------------------------- */
  console.log("\nFirst add");
  const { error: insErr } = await admin.from("cart_items").insert({
    cart_id: cart.id, product_id: V.product_id, variant_id: V.id, quantity: 1,
  });
  check("variant line inserts", !insErr, insErr?.message ?? "");

  const { error: insErr2 } = await admin.from("cart_items").insert({
    cart_id: cart.id, product_id: SIMPLE, variant_id: null, quantity: 1,
  });
  check("simple line inserts", !insErr2, insErr2?.message ?? "");

  /* ---- second add finds the existing line -------------------------------- */
  console.log("\nSecond add finds the existing line");
  const { data: found } = await findVariantLine();
  check("variant line is found", found?.quantity === 1, `qty ${found?.quantity}`);

  const { data: foundS } = await findSimpleLine();
  check(".is(variant_id, null) matches the simple line", foundS?.quantity === 1,
    `qty ${foundS?.quantity}`);

  // The increment path.
  await admin.from("cart_items")
    .update({ quantity: found.quantity + 2 })
    .eq("id", found.id).eq("cart_id", cart.id);
  const { data: bumped } = await findVariantLine();
  check("quantity increments to 3", bumped?.quantity === 3, `qty ${bumped?.quantity}`);

  /* ---- conflict code the action catches ---------------------------------- */
  console.log("\nDuplicate insert (the 23505 retry path)");
  const { error: dupErr } = await admin.from("cart_items").insert({
    cart_id: cart.id, product_id: V.product_id, variant_id: V.id, quantity: 1,
  });
  check("duplicate variant line is rejected", Boolean(dupErr));
  check("error code is 23505 as the action expects", dupErr?.code === "23505",
    `got ${dupErr?.code}`);

  const { error: dupSErr } = await admin.from("cart_items").insert({
    cart_id: cart.id, product_id: SIMPLE, variant_id: null, quantity: 1,
  });
  check("duplicate simple line is rejected with 23505", dupSErr?.code === "23505",
    `got ${dupSErr?.code}`);

  /* ---- a different variant is a separate line ---------------------------- */
  if (V2) {
    const { error: sepErr } = await admin.from("cart_items").insert({
      cart_id: cart.id, product_id: V2.product_id, variant_id: V2.id, quantity: 1,
    });
    check("a different variant opens its own line", !sepErr, sepErr?.message ?? "");
  }

  /* ---- ownership scoping ------------------------------------------------- */
  console.log("\nOwnership scoping");
  const { data: other } = await admin
    .from("carts").insert({ token: TOKEN + "_other" }).select("id").single();

  // Exactly what setLineQuantity does — line id from the client, cart id from
  // the cookie. The mismatch must change nothing.
  const { data: victim } = await findVariantLine();
  const { data: attacked } = await admin
    .from("cart_items")
    .update({ quantity: 99 })
    .eq("id", victim.id)
    .eq("cart_id", other.id)
    .select("id");

  check("update scoped to the wrong cart touches no rows",
    Array.isArray(attacked) && attacked.length === 0,
    `${attacked?.length ?? "?"} rows`);

  const { data: unchanged } = await findVariantLine();
  check("victim quantity is unchanged", unchanged?.quantity === 3,
    `qty ${unchanged?.quantity}`);

  const { data: delAttacked } = await admin
    .from("cart_items").delete()
    .eq("id", victim.id).eq("cart_id", other.id).select("id");
  check("delete scoped to the wrong cart removes nothing",
    Array.isArray(delAttacked) && delAttacked.length === 0,
    `${delAttacked?.length ?? "?"} rows`);

  const { data: stillThere } = await findVariantLine();
  check("victim line still exists", Boolean(stillThere));

  await admin.from("carts").delete().eq("token", TOKEN + "_other");

  /* ---- clear ------------------------------------------------------------- */
  console.log("\nClear");
  await admin.from("cart_items").delete().eq("cart_id", cart.id);
  const { data: after } = await admin
    .from("cart_items").select("id").eq("cart_id", cart.id);
  check("clearing empties the cart", after.length === 0, `${after.length} left`);

  /* ---- anon key must see nothing ----------------------------------------- */
  console.log("\nAnon key against the cart tables");
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  await admin.from("cart_items").insert({
    cart_id: cart.id, product_id: V.product_id, variant_id: V.id, quantity: 1,
  });

  const { data: anonCarts } = await anon.from("carts").select("id, token");
  check("anon cannot read carts", (anonCarts ?? []).length === 0,
    `${(anonCarts ?? []).length} rows`);

  const { data: anonItems } = await anon.from("cart_items").select("id");
  check("anon cannot read cart_items", (anonItems ?? []).length === 0,
    `${(anonItems ?? []).length} rows`);

  const { error: anonInsert } = await anon.from("carts").insert({ token: "anon_forged" });
  check("anon cannot forge a cart", Boolean(anonInsert), anonInsert?.code ?? "no error");

  const { error: anonItemInsert } = await anon.from("cart_items").insert({
    cart_id: cart.id, product_id: V.product_id, variant_id: V.id, quantity: 50,
  });
  check("anon cannot inject a cart line", Boolean(anonItemInsert),
    anonItemInsert?.code ?? "no error");

  const { data: anonUpd } = await anon
    .from("cart_items").update({ quantity: 99 }).eq("cart_id", cart.id).select("id");
  check("anon cannot alter a cart line", (anonUpd ?? []).length === 0,
    `${(anonUpd ?? []).length} rows`);
} finally {
  await admin.from("carts").delete().eq("token", TOKEN);
  await admin.from("carts").delete().eq("token", "anon_forged");
  const { data: left } = await admin.from("carts").select("id").eq("token", TOKEN);
  console.log(`\nCleaned up: ${(left ?? []).length === 0}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
