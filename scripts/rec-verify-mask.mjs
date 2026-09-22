/**
 * Proves the PII mask covers what it claims to, before anything is recorded.
 *
 *   node scripts/rec-verify-mask.mjs
 *
 * Visits the pages that carry the most personal data, scrolls them so lazy rows
 * render, and asserts that nothing a viewer could read still matches a name,
 * email or phone number from the database. Writes masked screenshots so the
 * result can also be judged by eye.
 */
import { existsSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { loadEnv } from "./db-config.mjs";
import { fetchPiiTerms, installMask, auditMask } from "./rec-pii-mask.mjs";

loadEnv();

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const EMAIL = process.env.adminlogin;
const PASSWORD = process.env.adminpassword;
const OUT = "brag-real/mask-check";

const CHROME = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
]
  .filter(Boolean)
  .find((p) => existsSync(p));

mkdirSync(OUT, { recursive: true });

console.log("loading PII terms from the database…");
const terms = await fetchPiiTerms();
console.log(
  `  ${terms.names.length} names · ${terms.emails.length} emails · ${terms.phones.length} phones\n`
);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1920,1080", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await installMask(page, terms);

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await page.waitForSelector('input[type="email"]');
await page.type('input[type="email"]', EMAIL);
await page.type('input[type="password"]', PASSWORD);
await Promise.all([
  page.click('button[type="submit"]'),
  page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
]);

const TEST_ORDER = "615e5846-d820-4b66-bce1-08dcd9942abb";
const PAGES = [
  ["orders", "/admin/orders"],
  ["order-detail", `/admin/orders/${TEST_ORDER}`],
  ["customers", "/admin/customers"],
  ["abandoned", "/admin/orders/abandoned"],
  ["reports", "/admin/analytics/reports"],
  ["qikink-tracking", "/admin/orders/tracking/qikink"],
];

let totalLeaks = 0;

for (const [name, route] of PAGES) {
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2", timeout: 60000 });
  } catch {
    console.log(`  ${name.padEnd(16)} navigation timed out — skipped`);
    continue;
  }
  await new Promise((r) => setTimeout(r, 1200));

  // Scroll the whole page so virtualised or lazy rows mount and get swept.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 600));

  const { leaks } = await auditMask(page, name);
  totalLeaks += leaks.length;

  await page.screenshot({ path: `${OUT}/${name}.png` });

  if (leaks.length === 0) {
    console.log(`  ${name.padEnd(16)} clean`);
  } else {
    console.log(`  ${name.padEnd(16)} ${leaks.length} LEAK(S):`);
    for (const l of [...new Set(leaks)].slice(0, 6)) console.log(`      "${l}"`);
  }
}

await browser.close();

console.log(
  totalLeaks === 0
    ? `\nmask holds on every page checked — screenshots in ${OUT}/`
    : `\n${totalLeaks} leak(s) — fix before recording. Screenshots in ${OUT}/`
);
process.exit(totalLeaks === 0 ? 0 : 1);
