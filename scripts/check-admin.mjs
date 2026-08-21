/**
 * End-to-end smoke test for the signed-in admin.
 *
 *   npm run check:admin          # against an already-running dev server
 *   BASE_URL=... npm run check:admin
 *
 * Everything else in scripts/ tests a layer in isolation — the matcher against
 * a fixture, the RPC against Postgres. This one signs in with a real browser
 * and drives the assembled product, which is the only place two correct layers
 * can still add up to a broken screen.
 *
 * Two things it guards:
 *
 *   1. The page gutter. Content must never sit closer than 40px to the sidebar
 *      or the right edge, at any width. This regressed once already: the gutter
 *      stopped growing at 32px, so full-bleed pages hugged the wall at every
 *      size and the capped pages collapsed to the same 32px near 1424px — which
 *      is exactly where a 1440px laptop sits.
 *
 *   2. Global search, end to end: the local catalogue tier, the Postgres tier,
 *      highlighting, group ordering, the keyboard, and navigation.
 *
 * Needs `adminlogin` / `adminpassword` in .env.local (gitignored). Skips
 * cleanly when they are absent so it is safe to wire into a wider check run.
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { loadEnv } from "./db-config.mjs";

loadEnv();

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.adminlogin;
const PASSWORD = process.env.adminpassword;

if (!EMAIL || !PASSWORD) {
  console.log("adminlogin / adminpassword not set in .env.local — skipping.");
  process.exit(0);
}

const CHROME = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((p) => existsSync(p));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });

const failures = [];
const ok = (label, pass, detail = "") => {
  if (!pass) failures.push(label);
  console.log(`  ${pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
};

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await page.waitForSelector('input[type="email"]');
await page.type('input[type="email"]', EMAIL);
await page.type('input[type="password"]', PASSWORD);
await Promise.all([
  page.click('button[type="submit"]'),
  page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
]);
if (page.url().includes("/login")) {
  console.error("sign-in failed");
  await browser.close();
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
console.log("\n\x1b[1mPage gutter — nothing may touch the wall\x1b[0m");
/* -------------------------------------------------------------------------- */

for (const [route, width] of [
  ["/admin/orders", 1280], ["/admin/orders", 1440], ["/admin/orders", 1920],
  ["/admin/products", 1920], ["/admin/products", 2560], ["/admin", 1920],
]) {
  await page.setViewport({ width, height: 1080 });
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2" });
  await page.waitForSelector("h1", { timeout: 15000 });

  const m = await page.evaluate(() => {
    const h1 = document.querySelector("main h1");
    const rects = [...document.querySelectorAll("main h1, main button, main a")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.top < 260);
    return {
      left: Math.round(Math.min(...rects.map((r) => r.left))),
      right: Math.round(window.innerWidth - Math.max(...rects.map((r) => r.right))),
      title: h1?.textContent?.trim(),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  const sidebar = width >= 768 ? 240 : 0;
  const leftGap = m.left - sidebar;
  ok(
    `${route} @${width}`.padEnd(26) + `left ${String(leftGap).padStart(4)}px · right ${String(m.right).padStart(4)}px`,
    leftGap >= 40 && m.right >= 40 && !m.overflow,
    m.overflow ? "horizontal overflow!" : `"${m.title}"`
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n\x1b[1mGlobal search — live, signed in\x1b[0m");
/* -------------------------------------------------------------------------- */

await page.setViewport({ width: 1920, height: 1080 });
await page.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle2" });

const search = 'input[role="combobox"]';
await page.waitForSelector(search);

// ⌘K / Ctrl+K from anywhere on the page.
await page.keyboard.down("Control");
await page.keyboard.press("k");
await page.keyboard.up("Control");
ok("Ctrl+K focuses the search box", await page.evaluate((s) =>
  document.activeElement === document.querySelector(s), search));

async function type(term) {
  await page.$eval(search, (el) => {
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type(search, term, { delay: 25 });
  // Local tier is synchronous; wait out the 140ms debounce for the remote tier.
  await new Promise((r) => setTimeout(r, 1200));
  return page.evaluate(() => {
    const panel = document.querySelector('[role="listbox"]');
    if (!panel) return { groups: [], rows: [] };
    return {
      groups: [...panel.querySelectorAll('[role="group"]')].map((g) => ({
        label: g.querySelector("p")?.textContent?.trim(),
        items: [...g.querySelectorAll('[role="option"]')].map((o) => ({
          title: o.querySelector("span > span")?.textContent?.trim(),
          marked: [...o.querySelectorAll("mark")].map((m) => m.textContent).join("|"),
        })),
      })),
      rows: [...panel.querySelectorAll('[role="option"]')].length,
    };
  });
}

const show = (r) =>
  r.groups.map((g) => `${g.label}: ${g.items.slice(0, 3).map((i) => i.title).join(", ")}`).join(" \x1b[2m//\x1b[0m ");

// A real product stem from the live catalogue.
let r = await type("hoodi");
console.log(`   \x1b[2m${show(r)}\x1b[0m`);
ok("product prefix returns matches", r.rows > 0, `${r.rows} rows`);
ok("matched characters are highlighted", r.groups[0]?.items[0]?.marked?.length > 0,
   `marked "${r.groups[0]?.items[0]?.marked}"`);

r = await type("tank top");
console.log(`   \x1b[2m${show(r)}\x1b[0m`);
ok("multi-word query matches", r.rows > 0, `${r.rows} rows`);

// The remote tier: a real order number.
r = await type("7586");
console.log(`   \x1b[2m${show(r)}\x1b[0m`);
ok("order number reaches the remote tier",
   r.groups.some((g) => g.label === "Orders"), `groups: ${r.groups.map((g) => g.label).join(",")}`);
ok("Orders group is ranked first for an order number",
   r.groups[0]?.label === "Orders", `first group: ${r.groups[0]?.label}`);

// Navigation commands.
r = await type("shipping");
console.log(`   \x1b[2m${show(r)}\x1b[0m`);
ok("keyword finds a settings page",
   r.groups.some((g) => g.label === "Go to"), `groups: ${r.groups.map((g) => g.label).join(",")}`);

// Typo tolerance on the catalogue.
r = await type("hoodei");
console.log(`   \x1b[2m${show(r)}\x1b[0m`);
ok("typo still finds products", r.rows > 0, `${r.rows} rows`);

await page.screenshot({ path: "search-dropdown.png", clip: { x: 500, y: 0, width: 950, height: 620 } });

// Keyboard navigation and Enter.
await type("hoodi");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
const activeRow = await page.evaluate(() => {
  const el = document.querySelector('[role="option"][data-active="true"]');
  return { text: el?.textContent?.slice(0, 40), index: [...document.querySelectorAll('[role="option"]')].indexOf(el) };
});
// Two presses from the default row 0.
ok("arrow keys move the highlight", activeRow.index === 2, `row ${activeRow.index}: ${activeRow.text}`);

await Promise.all([
  page.keyboard.press("Enter"),
  page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}),
]);
ok("Enter navigates to the result", /\/admin\/(products|orders|customers)\//.test(page.url()), page.url());

await browser.close();
console.log(failures.length ? `\n\x1b[31m${failures.length} failed\x1b[0m\n` : "\n\x1b[32mAll live checks passed.\x1b[0m\n");
process.exit(failures.length ? 1 : 0);
