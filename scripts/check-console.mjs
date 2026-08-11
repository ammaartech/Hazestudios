#!/usr/bin/env node
/**
 * Crawls the app and fails on anything the browser complained about.
 *
 *   npm run dev                    # in one terminal
 *   npm run check:console          # in another
 *
 *   BASE=https://... npm run check:console
 *   ROUTES=/,/cart npm run check:console
 *
 * A console warning is the cheapest signal a React app emits and the easiest to
 * stop reading. Once a page logs six of them on every load, the seventh — the
 * hydration mismatch that only bites on a slow connection, the act() warning
 * that means a state update is escaping a transition — arrives into a stream
 * nobody scans any more. So the bar here is zero, and the script is the thing
 * that keeps it there.
 *
 * Captures four separate channels, because they fail differently:
 *   - console.warn / console.error   the React and Next diagnostics
 *   - pageerror                      uncaught exceptions
 *   - requestfailed                  aborted or 4xx/5xx subresources
 *   - response >= 400                a broken image is invisible until it isn't
 *
 * Drives the Chrome already on the machine; puppeteer-core downloads nothing.
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://localhost:3000";

const SEED_ROUTES = [
  "/",
  "/cart",
  "/search",
  "/search?q=tee",
  "/account/login",
  "/account/register",
  "/collections/haze-studios",
  "/checkout",
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error("No Chrome or Edge found. Set CHROME_PATH to a Chromium binary.");
  process.exit(1);
}

/**
 * Noise that is not ours and cannot be fixed from this repo. Kept deliberately
 * short — every entry here is a warning someone stops seeing forever, so the
 * cost of a lazy regex is a real bug hiding behind it later.
 */
const IGNORE = [
  /Download the React DevTools/,
  /\[Fast Refresh\]/,
  /Failed to load resource: net::ERR_INTERNET_DISCONNECTED/,
  /*
   * The router prefetches every in-viewport link and cancels the ones still in
   * flight when a navigation starts. That cancellation surfaces as an aborted
   * `?_rsc=` request, so a crawler that clicks through a site sees dozens of
   * them — all of them the prefetcher working exactly as designed. Only the
   * `_rsc` flavour is ignored; an aborted *document* request is a real symptom
   * and still reports.
   */
  /net::ERR_ABORTED .*[?&]_rsc=/,
];

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

async function discoverRoutes() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const found = new Set(SEED_ROUTES);
  try {
    for (const seed of ["/", "/collections/haze-studios"]) {
      await page.goto(BASE + seed, { waitUntil: "networkidle2", timeout: 60000 });
      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute("href"))
      );
      for (const prefix of ["/products/", "/collections/", "/pages/", "/policies/"]) {
        const hit = hrefs.find((h) => h?.startsWith(prefix) && h !== prefix);
        if (hit) found.add(hit.split("?")[0]);
      }
    }
  } catch (err) {
    console.warn(`  (route discovery skipped: ${err.message.split("\n")[0]})`);
  }
  await page.close();
  return [...found];
}

const routes = process.env.ROUTES ? process.env.ROUTES.split(",") : await discoverRoutes();

console.log(`Checking ${routes.length} routes against ${BASE}\n`);

/** message -> { count, routes:Set, sample } so 40 repeats read as one problem. */
const findings = new Map();

function record(route, channel, text) {
  if (!text) return;
  if (IGNORE.some((re) => re.test(text))) return;
  // Collapse the per-instance tail (urls, ids, line numbers) so repeats group.
  const key = `${channel}\u0000${text.slice(0, 240)}`;
  const hit = findings.get(key) ?? { channel, count: 0, routes: new Set(), sample: text };
  hit.count += 1;
  hit.routes.add(route);
  findings.set(key, hit);
}

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

let current = "";
page.on("console", (msg) => {
  const type = msg.type();
  if (type !== "warning" && type !== "error") return;
  record(current, type === "warning" ? "console.warn" : "console.error", msg.text());
});
page.on("pageerror", (err) => record(current, "pageerror", err.message));
page.on("requestfailed", (req) => {
  const failure = req.failure();
  record(current, "requestfailed", `${failure?.errorText ?? "failed"} ${req.url().slice(0, 160)}`);
});
page.on("response", (res) => {
  if (res.status() >= 400) record(current, `http ${res.status()}`, res.url().slice(0, 160));
});

for (const route of routes) {
  current = route;
  process.stdout.write(`  ${route} ... `);
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
    // Give client effects, observers and lazy chunks a beat to run and complain.
    await new Promise((r) => setTimeout(r, 1500));
    console.log("done");
  } catch (err) {
    console.log("NAV FAILED");
    record(route, "navigation", err.message.split("\n")[0]);
  }
}

await browser.close();

/* -------------------------------------------------------------------------- */

if (findings.size === 0) {
  console.log("\nClean — no console warnings, errors, or failed requests.");
  process.exit(0);
}

const sorted = [...findings.values()].sort((a, b) => b.count - a.count);
console.log(`\n${sorted.length} distinct problems:\n`);
for (const f of sorted) {
  const where = [...f.routes].slice(0, 4).join(", ") + (f.routes.size > 4 ? `, +${f.routes.size - 4} more` : "");
  console.log(`[${f.channel}] x${f.count}  (${where})`);
  console.log(`  ${f.sample.replace(/\n/g, "\n  ").slice(0, 700)}\n`);
}
process.exit(1);
