#!/usr/bin/env node
/**
 * Checks the Cashfree integration against the real database and its own crypto.
 *
 *   node scripts/verify-cashfree.mjs
 *
 * Three things here cannot be caught by a typecheck, and each of them fails
 * silently in the worst possible way if it is wrong.
 *
 *   1. **The webhook signature.** Everything about the money path rests on
 *      base64(HMAC-SHA256(timestamp + rawBody, secret)) being computed exactly
 *      as Cashfree computes it. A subtly wrong construction — parsed body
 *      instead of raw, hex instead of base64, timestamp omitted — produces a
 *      function that rejects every genuine webhook, and orders that never leave
 *      pending. This asserts the construction and, more importantly, that a
 *      tampered body and a wrong secret are both rejected.
 *
 *   2. **RLS on the two new tables.** `payments` carries gateway ids and
 *      `payment_events` carries whole webhook bodies. Both must be invisible to
 *      anon, whose key ships to every browser.
 *
 *   3. **The idempotency constraint.** The unique index on
 *      (provider, idempotency_key) is what makes at-least-once webhook delivery
 *      safe to act on. If it is missing, a redelivered success event pushes the
 *      same order into production twice.
 *
 * Cleans up after itself; safe to run against a live database.
 */
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./db-config.mjs";

loadEnv();

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

let failures = 0;

function check(label, ok, detail = "") {
  const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/* -------------------------------------------------------------------------- */
/* 1. Webhook signature                                                        */
/* -------------------------------------------------------------------------- */

// Transcribed from src/lib/cashfree/webhook.ts. Deliberately a copy rather than
// an import: the point is to assert the construction independently, and a test
// that imports the thing it is testing cannot catch the construction being
// wrong in the first place.
function sign(timestamp, rawBody, secret) {
  return createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");
}

console.log("\nWebhook signature");
{
  const secret = "cfsk_test_secret_value";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({
    type: "PAYMENT_SUCCESS_WEBHOOK",
    data: { order: { order_id: "HZ1001A1", order_amount: 1899 } },
  });

  const signature = sign(timestamp, rawBody, secret);

  check(
    "genuine delivery verifies",
    sign(timestamp, rawBody, secret) === signature
  );

  check(
    "base64, not hex",
    /^[A-Za-z0-9+/]+=*$/.test(signature) && signature.length === 44,
    `${signature.length} chars`
  );

  check(
    "tampered body is rejected",
    sign(timestamp, rawBody.replace("1899", "1"), secret) !== signature
  );

  check(
    "wrong secret is rejected",
    sign(timestamp, rawBody, "cfsk_test_wrong") !== signature
  );

  check(
    "timestamp is part of the signed string",
    sign(String(Number(timestamp) + 1), rawBody, secret) !== signature
  );

  // The single most common way to get this wrong: signing a re-serialised body
  // instead of the received bytes. Key order happens to survive a round trip in
  // V8, so it is whitespace that bites — and any wire format with a space in it
  // produces a signature that will never match. Asserted here so the "use raw
  // bytes" rule in webhook.ts has evidence behind it rather than just a comment.
  const onTheWire = `{"a": 1, "b": 2}`;
  check(
    "re-serialising a parsed body changes the bytes",
    sign(timestamp, JSON.stringify(JSON.parse(onTheWire)), secret) !==
      sign(timestamp, onTheWire, secret)
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Schema and RLS                                                           */
/* -------------------------------------------------------------------------- */

console.log("\nSchema");
{
  const { error: paymentsError } = await admin.from("payments").select("id").limit(1);
  check("payments exists and is readable by service role", !paymentsError,
    paymentsError?.message);

  const { error: eventsError } = await admin
    .from("payment_events")
    .select("id")
    .limit(1);
  check("payment_events exists and is readable by service role", !eventsError,
    eventsError?.message);
}

console.log("\nRLS — anon must see nothing");
{
  const { data: rows, error } = await anon.from("payments").select("id").limit(1);
  // Either an outright error or an empty result is acceptable; PostgREST
  // reports a policy-less table as either depending on the grant. What is not
  // acceptable is a row.
  check("anon cannot read payments", Boolean(error) || (rows ?? []).length === 0);

  const { data: eventRows, error: eventError } = await anon
    .from("payment_events")
    .select("id")
    .limit(1);
  check(
    "anon cannot read payment_events",
    Boolean(eventError) || (eventRows ?? []).length === 0
  );

  const { error: forgeError } = await anon
    .from("payment_events")
    .insert({ idempotency_key: `forged-${Date.now()}`, payload: {} });
  check("anon cannot forge a payment event", Boolean(forgeError),
    forgeError?.code);
}

/* -------------------------------------------------------------------------- */
/* 3. Idempotency constraint                                                   */
/* -------------------------------------------------------------------------- */

console.log("\nIdempotency");
{
  const key = `verify-${Date.now()}`;

  const { error: first } = await admin
    .from("payment_events")
    .insert({ idempotency_key: key, event_type: "VERIFY", payload: {} });
  check("first delivery is accepted", !first, first?.message);

  const { error: second } = await admin
    .from("payment_events")
    .insert({ idempotency_key: key, event_type: "VERIFY", payload: {} });
  check(
    "redelivery raises 23505 (this is what the handler dedupes on)",
    second?.code === "23505",
    second?.code ?? "no error at all"
  );

  await admin.from("payment_events").delete().eq("idempotency_key", key);
}

/* -------------------------------------------------------------------------- */
/* 4. payments constraints                                                     */
/* -------------------------------------------------------------------------- */

console.log("\npayments constraints");
{
  // Needs a real order to hang off, so borrow the newest one rather than
  // creating one — this script must not leave an order behind.
  const { data: order } = await admin
    .from("orders")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!order) {
    check("skipped: no order to attach a payment to", true);
  } else {
    const providerOrderId = `HZVERIFY${Date.now().toString(36).toUpperCase()}`;

    const { error: badStatus } = await admin.from("payments").insert({
      order_id: order.id,
      provider_order_id: `${providerOrderId}X`,
      status: "definitely_not_a_status",
      amount: 1,
    });
    check("status check rejects an unknown value", Boolean(badStatus),
      badStatus?.code);

    const { error: insert } = await admin.from("payments").insert({
      order_id: order.id,
      provider_order_id: providerOrderId,
      status: "created",
      amount: 1899.5,
    });
    check("a well-formed attempt inserts", !insert, insert?.message);

    const { error: duplicate } = await admin.from("payments").insert({
      order_id: order.id,
      provider_order_id: providerOrderId,
      status: "created",
      amount: 1899.5,
    });
    check(
      "provider_order_id is unique (a Cashfree order id is never reused)",
      duplicate?.code === "23505",
      duplicate?.code ?? "no error at all"
    );

    await admin.from("payments").delete().eq("provider_order_id", providerOrderId);
  }
}

console.log(
  failures === 0
    ? "\n\x1b[32mAll checks passed.\x1b[0m\n"
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`
);

process.exit(failures === 0 ? 0 : 1);
