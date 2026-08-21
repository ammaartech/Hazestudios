/**
 * Ranking checks for the admin search matcher.
 *
 *   npm run verify:search
 *
 * Two halves, and both matter:
 *
 *   1. Synthetic cases over a fixed catalogue, asserting the *ordering* the
 *      tier ladder is supposed to produce. Ordering is the entire product here
 *      — "does it match" is easy and every naive approach gets it right; "does
 *      the right one come first" is what separates this from an ilike.
 *
 *   2. The same matcher run against the live catalogue, printing what an
 *      operator would actually see for the queries they actually type. Ranking
 *      quality is not something a boolean assertion can capture, so these are
 *      printed for reading rather than asserted — except where a specific
 *      product must be the top hit, which is asserted.
 *
 * Run against the source with a small TS strip step so there is no build in the
 * loop: Node 22+ runs `--experimental-strip-types` on plain type annotations,
 * which is all fuzzy.ts and types.ts use.
 */

import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);

const { prepareQuery, matchItem, segments } = await import(
  "../src/lib/search/fuzzy.ts"
);
const { indexProducts } = await import("../src/lib/search/types.ts");

/* -------------------------------------------------------------------------- */

let failures = 0;
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function rank(items, query) {
  const q = prepareQuery(query);
  if (!q) return [];
  return items
    .map((item) => {
      const m = matchItem(q, item.fields, item.boost);
      return m ? { item, ...m } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `  ${ok ? c.green("✓") : c.red("✗")} ${label}` +
      (ok ? "" : c.red(`\n      expected ${expected}\n      got      ${actual}`))
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Synthetic ordering cases                                                 */
/* -------------------------------------------------------------------------- */

const FIXTURE = [
  // id, title, vendor, type, tags, sku, status, cover
  ["1", "Stussy Diced", "STUSSY", "FG-TSHIRTS", ["streetwear"], "", "active", null],
  ["2", "Custom Stusser Bag", "FOGSTORES", "", ["bags"], "", "active", null],
  ["3", "Stussy", "STUSSY", "", [], "", "active", null],
  ["4", "Blue Hoodie", "FOGSTORES", "FG-HOODIES", ["stussy"], "", "active", null],
  ["5", "Kai Hoodie", "FOGSTORES", "", [], "", "active", null],
  ["6", "Kai Hoodie Oversized Limited Edition", "FOGSTORES", "", [], "", "active", null],
  ["7", "I’m Out Of My Mind Yellow Tank Top", "FOGSTORES", "FG-TANKTOPS", [], "", "active", null],
  ["8", "Katy Long Sleeve Top", "FOGSTORES", "", ["TOPS"], "", "active", null],
  ["9", "Retired Stussy Tee", "STUSSY", "", [], "", "archived", null],
  ["10", "Fight Your Fears", "HAZE STUDIOS", "HZ-QI-TSHIRTS", ["qikink"], "V-8RCP0I6AD1RD", "active", null],
];

const fixture = indexProducts(FIXTURE);
const top = (q) => rank(fixture, q)[0]?.item.title ?? "(none)";
const titles = (q) => rank(fixture, q).map((r) => r.item.title);

console.log(c.bold("\nOrdering — the tier ladder"));

// The headline case. Typing four letters must surface every product whose
// *title* begins with them, tightest first, above one that merely contains the
// stem mid-title — and above anything matching only on a tag or a vendor.
check(
  '"stus" ranks every stussy title, tightest first',
  titles("stus").slice(0, 3).join(" | "),
  "Stussy | Stussy Diced | Custom Stusser Bag"
);
check('"stussy" prefers the exact title', top("stussy"), "Stussy");
check('"diced" finds a non-leading word', top("diced"), "Stussy Diced");
check('"diced stus" is order-independent', top("diced stus"), "Stussy Diced");
check('"tank top" spans two words', top("tank top"), "I’m Out Of My Mind Yellow Tank Top");
check("smart quotes fold to ASCII", top("i'm out"), "I’m Out Of My Mind Yellow Tank Top");
check("shorter title wins an equal match", top("kai hoodie"), "Kai Hoodie");
check("SKU matches are found", top("8rcp0i6"), "Fight Your Fears");

console.log(c.bold("\nOrdering — typo tolerance"));
check('"stussi" survives a substitution', top("stussi"), "Stussy");
check('"sutssy" survives a transposition', top("sutssy"), "Stussy");
check('"hoodei" survives a transposition', top("hoodei"), "Kai Hoodie");

console.log(c.bold("\nOrdering — precedence guarantees"));
check(
  "a title prefix outranks a tag match",
  titles("stussy")[0] !== "Blue Hoodie",
  true
);
check(
  "archived is demoted, not hidden",
  titles("stussy").includes("Retired Stussy Tee"),
  true
);
check(
  "archived ranks below active",
  titles("stussy").indexOf("Retired Stussy Tee") >
    titles("stussy").indexOf("Stussy Diced"),
  true
);
check(
  'a vendor-only match still surfaces ("fogstores")',
  rank(fixture, "fogstores").length > 0,
  true
);
check(
  "three-character queries do not fuzzy-match everything",
  rank(fixture, "xyz").length,
  0
);

console.log(c.bold("\nHighlighting"));
{
  const r = rank(fixture, "stus").find((x) => x.item.title === "Stussy Diced");
  const painted = segments(r.item.title, r.ranges)
    .map((s) => (s.hit ? `[${s.text}]` : s.text))
    .join("");
  check("highlight lands on the matched span", painted, "[Stus]sy Diced");
}
{
  const r = rank(fixture, "sd")[0];
  const painted = segments(r.item.title, r.ranges)
    .map((s) => (s.hit ? `[${s.text}]` : s.text))
    .join("");
  check("initialism highlights both word starts", painted, "[S]tussy [D]iced");
}
{
  const r = rank(fixture, "8rcp0i6")[0];
  check("a non-title match reports which field matched", r.via, "SKU");
  check("a non-title match paints no highlight", r.ranges.length, 0);
}

/* -------------------------------------------------------------------------- */
/* 2. The live catalogue                                                       */
/* -------------------------------------------------------------------------- */

const { default: pg } = await import("pg");
const { dbConfig } = await import("./db-config.mjs");

const client = new pg.Client({ ...dbConfig(), ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(`
  select p.id, p.title, p.vendor, p.product_type, p.tags, p.sku, p.status,
         (select url from product_images i where i.product_id = p.id
          order by position limit 1) as cover
  from products p`);

const live = indexProducts(
  rows.map((r) => [
    r.id,
    r.title,
    r.vendor,
    r.product_type,
    r.tags ?? [],
    r.sku ?? "",
    r.status,
    r.cover,
  ])
);

console.log(c.bold(`\nLive catalogue — ${live.length} products`));

// Timing. The claim this design rests on is that a keystroke costs nothing, so
// it should be measured rather than asserted from the big-O.
const PROBES = ["s", "st", "stu", "hoodie", "tank top", "yellow", "card bd"];
const t0 = performance.now();
const ITERATIONS = 20;
for (let i = 0; i < ITERATIONS; i++) for (const p of PROBES) rank(live, p);
const perQuery = (performance.now() - t0) / (ITERATIONS * PROBES.length);
console.log(
  `  ${perQuery < 8 ? c.green("✓") : c.red("✗")} ${perQuery.toFixed(2)} ms per keystroke ` +
    c.dim(`(${live.length} products, ${PROBES.length} probes × ${ITERATIONS})`)
);
if (perQuery >= 8) failures++;

for (const q of ["hoodi", "tank", "long sleeve", "cardd", "birthday", "vest"]) {
  const results = rank(live, q).slice(0, 5);
  console.log(`\n  ${c.cyan(`"${q}"`)} ${c.dim(`${rank(live, q).length} matches`)}`);
  for (const r of results) {
    const painted = segments(r.item.title, r.ranges)
      .map((s) => (s.hit ? c.bold(s.text) : c.dim(s.text)))
      .join("");
    console.log(
      `    T${r.tier} ${String(Math.round(r.score)).padStart(6)}  ${painted}` +
        (r.via ? c.dim(`  via ${r.via}`) : "")
    );
  }
}

/* -------------------------------------------------------------------------- */
/* 3. The remote tier — admin_search() over orders, customers and SKUs         */
/* -------------------------------------------------------------------------- */

console.log(c.bold("\nRemote tier — admin_search()"));

// A real order and a real customer, so the checks assert against data that
// exists rather than against a guess about it.
const { rows: [sample] } = await client.query(`
  select o.order_name, o.order_number, o.email,
         nullif(btrim(c.first_name || ' ' || c.last_name), '') as customer_name
  from orders o
  join customers c on c.id = o.customer_id
  where o.order_name is not null and o.email <> ''
    and length(btrim(c.first_name)) > 3
  order by o.created_at desc
  limit 1`);

async function rpc(q, lim = 5) {
  const started = performance.now();
  const { rows } = await client.query("select * from admin_search($1, $2)", [q, lim]);
  return { rows, ms: performance.now() - started };
}

if (!sample) {
  console.log(c.dim("  no order with a customer and an email — skipped"));
} else {
  const found = async (q, kind, predicate) => {
    const { rows } = await rpc(q, 8);
    return rows.some((r) => r.kind === kind && predicate(r));
  };

  check(
    `order number "${sample.order_number}" finds its order`,
    await found(String(sample.order_number), "order", (r) =>
      r.title.includes(String(sample.order_number))
    ),
    true
  );
  check(
    `order name "${sample.order_name}" finds its order`,
    await found(sample.order_name, "order", (r) => r.title === sample.order_name),
    true
  );
  check(
    "a partial order number prefix-matches",
    await found(String(sample.order_number).slice(0, 3), "order", () => true),
    true
  );
  check(
    `email "${sample.email}" finds the order and the customer`,
    (await rpc(sample.email, 8)).rows.some((r) => r.kind === "customer") &&
      (await found(sample.email, "order", () => true)),
    true
  );

  // Typo tolerance, which is the one thing the trigram index is really for.
  const typo =
    sample.customer_name.slice(0, -2) +
    sample.customer_name.slice(-1) +
    sample.customer_name.slice(-2, -1);
  check(
    `transposed name "${typo}" still finds "${sample.customer_name}"`,
    await found(typo, "customer", (r) => r.title === sample.customer_name),
    true
  );

  check(
    "a one-character query returns nothing rather than everything",
    (await rpc("a", 8)).rows.length,
    0
  );

  // Latency. The remote tier is debounced and merges in late, so it does not
  // block the dropdown — but it still has to arrive while the query is on
  // screen. Measured from this machine, so it includes the real round trip.
  const probes = ["7586", "gmail.com", "shreya", "98703"];
  let worst = 0;
  for (const p of probes) worst = Math.max(worst, (await rpc(p)).ms);
  console.log(
    `  ${worst < 900 ? c.green("✓") : c.red("✗")} ${worst.toFixed(0)} ms worst round trip ` +
      c.dim(`(${probes.length} probes, includes network to ap-south-1)`)
  );
  if (worst >= 900) failures++;

  for (const q of [String(sample.order_number).slice(0, 3), sample.customer_name.slice(0, 4)]) {
    const { rows } = await rpc(q, 3);
    console.log(`\n  ${c.cyan(`"${q}"`)} ${c.dim(`${rows.length} rows`)}`);
    for (const r of rows) {
      console.log(
        `    ${r.score.toFixed(2)}  ${c.dim(r.kind.padEnd(9))} ${r.title}` +
          c.dim(r.subtitle ? `  — ${r.subtitle}` : "")
      );
    }
  }
}

await client.end();

console.log(
  failures === 0
    ? c.green(`\nAll checks passed.\n`)
    : c.red(`\n${failures} check(s) failed.\n`)
);
process.exit(failures === 0 ? 0 : 1);
