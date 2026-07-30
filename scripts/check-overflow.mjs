#!/usr/bin/env node
/**
 * Fails if any storefront page is wider than the screen it is being viewed on.
 *
 *   npm run dev                     # in one terminal
 *   npm run check:overflow          # in another
 *
 *   BASE=https://... npm run check:overflow      # audit a deployment
 *   WIDTHS=390,768 ROUTES=/,/cart npm run check:overflow
 *
 * Horizontal overflow is the one layout bug that has no local blast radius. A
 * single box a few pixels too wide does not clip quietly at the edge — it makes
 * the *document* that wide, and every browser then reconciles that against the
 * screen in its own way. Chrome leaves a sideways scroll. Mobile Safari shrinks
 * the entire page to fit the content, so a 213px overhang renders the whole
 * storefront at ~65% scale with a band of bare white down one side. The page
 * looks broken in a way that has nothing to do with the element that caused it,
 * which is why this is worth a machine check rather than an eye.
 *
 * `overflow-x: clip` on the root (see globals.css) stops the panning, but it is
 * a backstop, not a fix: the content is still that wide, and Safari still
 * shrinks to it. The only thing that actually holds is content that fits.
 *
 * Drives the Chrome already installed on the machine — puppeteer-core downloads
 * no browser of its own. Set CHROME_PATH to point at a different one.
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://localhost:3000";

/**
 * The narrowest phone still in circulation through to a desktop ultrawide, plus
 * the awkward middle — the 540-820 band is where a layout that was designed at
 * "phone" and "desktop" tends to come apart, and where `sm:`/`md:` hand over.
 */
const WIDTHS = (process.env.WIDTHS ?? "320,360,375,390,412,430,480,540,640,768,820,1024,1280,1440,1920,2560")
  .split(",")
  .map(Number);

/** Static routes worth checking on every run; the rest are discovered below. */
const SEED_ROUTES = ["/", "/cart", "/search", "/account/login", "/collections/haze-studios"];

/* -------------------------------------------------------------------------- */
/* Browser                                                                     */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* The measurement, and the diagnosis                                          */
/* -------------------------------------------------------------------------- */

/**
 * Runs inside the page.
 *
 * Two questions, because the interesting failures answer them differently.
 *
 * "How wide is the document" is the symptom, and it is what the browsers react
 * to. "Which box did that" is the part a naive `getBoundingClientRect()` sweep
 * gets wrong: it reports every card inside a horizontal rail as overflowing,
 * because a rect is measured against the viewport and knows nothing about the
 * scroll container clipping it. Those are false positives, and there are dozens
 * of them on a page built out of carousels.
 *
 * So the offenders are found by removal instead — hide a box, remeasure, and
 * keep the ones that actually bring the number down. That walks straight past
 * anything a scroller already contains, and lands on the real culprit even when
 * it is an absolutely positioned descendant that escaped its scroller's clip,
 * which is the failure mode with no visual tell at all.
 */
function measure() {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const docWidth = Math.max(de.scrollWidth, document.body.scrollWidth);
  if (docWidth <= vw + 1) return { vw, docWidth, over: 0, culprits: [] };

  const describe = (el) => {
    const cls = typeof el.className === "string" ? el.className : "";
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      sel: `<${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? ` class="${cls.slice(0, 110)}"` : ""}>`,
      position: cs.position,
      overflowX: cs.overflowX,
      rect: `x:[${Math.round(r.left)}, ${Math.round(r.right)}]`,
      /* An absolutely positioned box whose offsetParent sits outside the
         nearest clipping ancestor is the escape hatch described in the rail
         block of globals.css: the scroller cannot clip it, so it keeps its
         static position deep inside the scroll content and hands that width to
         the document. Naming it here is the whole diagnosis. */
      escapesClip: (() => {
        if (cs.position !== "absolute") return false;
        let p = el.parentElement;
        while (p) {
          const ps = getComputedStyle(p);
          if (ps.overflowX !== "visible" || ps.overflowY !== "visible") break;
          p = p.parentElement;
        }
        return Boolean(p && el.offsetParent && !p.contains(el.offsetParent));
      })(),
    };
  };

  // Descend to the deepest single box still responsible for the width.
  const culprits = [];
  let node = document.body;
  for (let depth = 0; depth < 30; depth++) {
    let guilty = null;
    for (const child of node.children) {
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
      const prev = child.style.display;
      child.style.display = "none";
      void de.offsetWidth;
      const shrank = de.scrollWidth <= vw + 1;
      child.style.display = prev;
      void de.offsetWidth;
      if (shrank) {
        guilty = child;
        break;
      }
    }
    if (!guilty) break;
    culprits.push(describe(guilty));
    node = guilty;
  }

  return { vw, docWidth, over: docWidth - vw, culprits };
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

/**
 * One real URL per dynamic template. A product page proves nothing about the
 * `/products/[id]` template if the id does not resolve, so the handles are
 * taken from the storefront's own links rather than hardcoded.
 */
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
      // One example of each dynamic shape is enough; the templates are shared.
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

console.log(`Checking ${routes.length} routes x ${WIDTHS.length} widths against ${BASE}\n`);

const failures = [];
const page = await browser.newPage();

for (const route of routes) {
  const bad = [];
  for (const width of WIDTHS) {
    await page.setViewport({
      width,
      height: 900,
      deviceScaleFactor: 1,
      isMobile: width < 768,
      hasTouch: width < 768,
    });
    await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
    // Let fonts settle and any reveal/entrance animation land: a transform
    // mid-flight can read as overflow that is not there a moment later.
    await new Promise((r) => setTimeout(r, 350));

    const res = await page.evaluate(measure);
    if (res.over > 1) bad.push({ width, ...res });
  }

  console.log(`${bad.length ? "FAIL" : "ok  "}  ${route}`);
  for (const b of bad) {
    console.log(`        ${b.width}px viewport -> ${b.docWidth}px document (+${b.over})`);
    for (const c of b.culprits.slice(-3)) {
      console.log(`          ${c.sel}`);
      console.log(
        `            ${c.rect} position=${c.position} overflow-x=${c.overflowX}` +
          (c.escapesClip ? "  <- ESCAPES ITS SCROLLER'S CLIP" : "")
      );
    }
  }
  if (bad.length) failures.push(route);
}

await page.close();
await browser.close();

console.log(
  failures.length
    ? `\n${failures.length} route(s) overflow: ${failures.join(", ")}`
    : `\nAll ${routes.length} routes fit every width from ${WIDTHS[0]}px to ${WIDTHS.at(-1)}px.`
);
process.exit(failures.length ? 1 : 0);
