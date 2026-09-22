/**
 * Re-shoots one section: the admin dashboard.
 *
 *   node scripts/rec-admin-home.mjs
 *
 * In the main capture this page never got past its skeletons. `networkidle2`
 * fires long before the 30-day analytics land, and the main run's 30s settle
 * budget was not enough — the whole 16s section came out as loading bars.
 *
 * So this waits as long as it takes, confirms real numbers are on screen, and
 * only then records a dwell. Cheaper than re-running the whole walkthrough.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { loadEnv } from "./db-config.mjs";
import { fetchPiiTerms, installMask } from "./rec-pii-mask.mjs";

loadEnv();

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const OUT = "brag-real";
const FRAMES = join(OUT, "frames-adminhome");
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  `${(process.env.LOCALAPPDATA ?? "").replace(/\\/g, "/")}/Google/Chrome/Application/chrome.exe`,
].find((p) => existsSync(p));

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1920,1080", "--hide-scrollbars", "--force-device-scale-factor=1"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await installMask(page, await fetchPiiTerms());

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await page.type('input[type="email"]', process.env.adminlogin);
await page.type('input[type="password"]', process.env.adminpassword);
await Promise.all([
  page.click('button[type="submit"]'),
  page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
]);

console.log("loading the dashboard — this page is slow, waiting it out…");
const t0 = Date.now();
await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 180000 }).catch(() => {});

// Wait for skeletons to clear AND for something numeric to actually be shown.
// The dashboard greets by time of day and then shows money. Waiting on the
// absence of skeletons was not enough: the nav chrome alone satisfied it while
// the content area was still empty.
const probe = setInterval(async () => {
  const st = await page
    .evaluate(() => ({
      h1: (document.querySelector("h1")?.innerText || "").slice(0, 40),
      skel: document.querySelectorAll('[data-slot="skeleton"]').length,
      rupee: (document.body.innerText || "").includes("₹"),
      len: (document.body.innerText || "").length,
    }))
    .catch(() => null);
  if (st) console.log(`   …h1="${st.h1}" skeletons=${st.skel} rupee=${st.rupee} chars=${st.len}`);
}, 10000);

await page
  .waitForFunction(
    () => {
      const h1 = document.querySelector("h1")?.innerText || "";
      const greeted = /good (morning|afternoon|evening)/i.test(h1);
      const money = (document.body.innerText || "").includes("₹");
      return greeted && money && !document.querySelector('[data-slot="skeleton"]');
    },
    { timeout: 180000, polling: 1000 }
  )
  .catch(() => console.log("  (timed out waiting for dashboard content)"));
clearInterval(probe);
await page.screenshot({ path: "brag-real/check/adminhome-state.png" });

console.log(`  dashboard ready after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await sleep(1500);
await page.evaluate(() => window.__hfSweep && window.__hfSweep()).catch(() => {});

const preview = await page.evaluate(() =>
  (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 160)
);
console.log(`  on screen: ${preview}`);

/* ---- record the dwell ---------------------------------------------------- */

const client = await page.createCDPSession();
const meta = [];
const writes = [];
let n = 0;
const start = Date.now();

client.on("Page.screencastFrame", ({ data, sessionId }) => {
  const i = n++;
  meta.push({ i, t: Date.now() - start });
  writes.push(writeFile(join(FRAMES, `${String(i).padStart(6, "0")}.jpg`), Buffer.from(data, "base64")));
  client.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

await client.send("Page.startScreencast", {
  format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1,
});

await sleep(2500);

/*
 * This page fits the viewport and never scrolls, so `scrollBy` produced no
 * repaints and the screencast emitted exactly one frame. Real pointer movement
 * does repaint — the quick actions and cards have hover states — which is what
 * gives the section something to look at.
 */
const tour = [
  [960, 330], [920, 390], [1060, 390], [1216, 390],
  [733, 600], [1079, 600], [1426, 600],
  [640, 95], [810, 95], [960, 95],
];
for (const [x, y] of tour) {
  await page.mouse.move(x, y, { steps: 18 });
  await sleep(700);
}
await sleep(2500);

await client.send("Page.stopScreencast").catch(() => {});
await Promise.all(writes);
await browser.close();

writeFileSync(join(OUT, "adminhome.json"), JSON.stringify({ frames: meta }, null, 2));
console.log(`\ncaptured ${meta.length} frames over ${(meta.at(-1).t / 1000).toFixed(1)}s -> ${FRAMES}/`);
