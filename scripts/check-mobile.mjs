#!/usr/bin/env node
/**
 * Fails on the three phone-layout faults that have no desktop tell.
 *
 *   npm run dev            # in one terminal
 *   npm run check:mobile   # in another
 *
 *   BASE=https://... npm run check:mobile
 *   WIDTHS=390 ROUTES=/,/cart npm run check:mobile
 *
 * In Git Bash on Windows, prefix that last one with `MSYS_NO_PATHCONV=1`. MSYS
 * rewrites any argument that looks like a Unix path, so a bare `ROUTES=/` is
 * handed to node as `C:/Program Files/Git/` and every URL built from it is
 * invalid. The failure surfaces as a puppeteer `Cannot navigate to invalid URL`
 * that looks nothing like a quoting problem.
 *
 * Companion to `check:overflow`, which measures document width across every
 * breakpoint from 320px to 2560px. This one asks the questions that are only
 * questions on a handset, and that a desktop browser will never answer wrong:
 *
 * 1. FOCUS ZOOM. Mobile Safari zooms the page in when a focused form control's
 *    font-size is under 16px, and does not zoom back out on blur. The page is
 *    then stuck at ~114% with the viewport narrower than the layout, so it pans
 *    sideways under the thumb for the rest of the session. Reported as "it
 *    randomly zooms in and then I can slide the page left and right", which
 *    sounds like an overflow bug and is not one — the document is the right
 *    width throughout. No desktop browser does this, and Chrome's mobile
 *    emulation does not either, so nothing but an explicit check catches it.
 *
 * 2. SCROLL CHAINING. A horizontal scroller whose `overscroll-behavior-x` is
 *    `auto` hands a flick past its end to the page. On iOS a horizontal
 *    over-flick near the start is taken as the back-navigation gesture, so
 *    over-swiping a product carousel navigates off the store.
 *
 * 3. HORIZONTAL OVERFLOW, at phone widths, with the offender named by removal
 *    rather than by a rect sweep — see check-overflow.mjs for why that matters.
 *
 * Drives the Chrome already on the machine; puppeteer-core downloads nothing.
 * Set CHROME_PATH to point at a different binary.
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const WIDTHS = (process.env.WIDTHS ?? "360,390,430").split(",").map(Number);

/** The routes a shopper actually reaches on a phone; product/collection discovered. */
const SEED_ROUTES = ["/", "/cart", "/search", "/account/login", "/checkout"];

const CHROME = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]
  .filter(Boolean)
  .find((p) => existsSync(p));

if (!CHROME) {
  console.error("No Chrome or Edge found. Set CHROME_PATH to a Chromium binary.");
  process.exit(1);
}

/* ------------------------------------------------------------------ probes */
/* Each runs inside the page and returns plain data. */

/** Every focusable text control whose font-size is under the iOS zoom threshold. */
function probeFocusZoom() {
  const SKIP = new Set(["hidden", "checkbox", "radio", "range", "file", "button", "submit", "reset", "image", "color"]);
  const out = [];
  for (const el of document.querySelectorAll("input, select, textarea")) {
    if (el.tagName === "INPUT" && SKIP.has(el.type)) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px >= 16) continue;
    const cls = typeof el.className === "string" ? el.className : "";
    out.push(
      `${px}px  <${el.tagName.toLowerCase()}${el.type ? ` type="${el.type}"` : ""}` +
        `${el.name ? ` name="${el.name}"` : ""}>  ${cls.slice(0, 72)}`
    );
  }
  return out;
}

/** Horizontal scrollers that let a flick escape to the page. */
function probeScrollChaining() {
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== "auto" && cs.overflowX !== "scroll") continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (cs.overscrollBehaviorX !== "auto") continue;
    const cls = typeof el.className === "string" ? el.className : "";
    out.push(`<${el.tagName.toLowerCase()} class="${cls.slice(0, 72)}">  snap=${cs.scrollSnapType}`);
  }
  return out;
}

/** Document width, and the deepest single box still responsible for it. */
function probeOverflow() {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const doc = Math.max(de.scrollWidth, document.body.scrollWidth);
  if (doc <= vw + 1) return null;

  const culprits = [];
  let node = document.body;
  for (let depth = 0; depth < 30; depth++) {
    let guilty = null;
    for (const child of node.children) {
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
      const prev = child.style.display;
      child.style.display = "none";
      void de.offsetWidth;
      if (de.scrollWidth <= vw + 1) guilty = child;
      child.style.display = prev;
      void de.offsetWidth;
      if (guilty) break;
    }
    if (!guilty) break;
    const cls = typeof guilty.className === "string" ? guilty.className : "";
    const cs = getComputedStyle(guilty);
    culprits.push(
      `<${guilty.tagName.toLowerCase()} class="${cls.slice(0, 72)}">  position=${cs.position}`
    );
    node = guilty;
  }
  return { vw, doc, over: doc - vw, culprits };
}

/* --------------------------------------------------------------------- run */

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

/** One real URL per dynamic template, taken from the storefront's own links. */
async function discoverRoutes() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const found = new Set(SEED_ROUTES);
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute("href"))
    );
    for (const prefix of ["/products/", "/collections/", "/policies/"]) {
      const hit = hrefs.find((h) => h?.startsWith(prefix) && h !== prefix);
      if (hit) found.add(hit.split("?")[0]);
    }
  } catch (err) {
    console.warn(`  (route discovery skipped: ${err.message.split("\n")[0]})`);
  }
  await page.close();
  return [...found];
}

const routes = process.env.ROUTES ? process.env.ROUTES.split(",") : await discoverRoutes();

console.log(`Checking ${routes.length} routes x ${WIDTHS.length} phone widths against ${BASE}\n`);

const page = await browser.newPage();
const failures = [];

for (const route of routes) {
  const faults = [];

  for (const width of WIDTHS) {
    await page.setViewport({
      width,
      height: 844,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
    // Let fonts settle and entrance animations land — a transform mid-flight
    // reads as overflow that is not there a moment later.
    await new Promise((r) => setTimeout(r, 350));

    const zoom = await page.evaluate(probeFocusZoom);
    const chain = await page.evaluate(probeScrollChaining);
    const over = await page.evaluate(probeOverflow);

    if (zoom.length) faults.push({ width, kind: "iOS focus zoom (font-size < 16px)", rows: zoom });
    if (chain.length) faults.push({ width, kind: "scroll chaining (overscroll-behavior-x: auto)", rows: chain });
    if (over) {
      faults.push({
        width,
        kind: `horizontal overflow: ${over.doc}px document in a ${over.vw}px viewport (+${over.over})`,
        rows: over.culprits.slice(-3),
      });
    }
  }

  console.log(`${faults.length ? "FAIL" : "ok  "}  ${route}`);
  for (const f of faults) {
    console.log(`        ${f.width}px — ${f.kind}`);
    for (const row of f.rows) console.log(`          ${row}`);
  }
  if (faults.length) failures.push(route);
}

await page.close();
await browser.close();

console.log(
  failures.length
    ? `\n${failures.length} route(s) with phone-layout faults: ${failures.join(", ")}`
    : `\nAll ${routes.length} routes clean at ${WIDTHS.join("px, ")}px.`
);
process.exit(failures.length ? 1 : 0);
