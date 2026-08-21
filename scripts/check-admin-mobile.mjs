#!/usr/bin/env node
/**
 * Fails when a signed-in admin page does not fit the phone it is viewed on.
 *
 *   npm run dev                  # in one terminal
 *   npm run check:admin:mobile   # in another
 *
 *   WIDTHS=390 ROUTES=/admin/orders npm run check:admin:mobile
 *
 * In Git Bash on Windows, prefix that last one with `MSYS_NO_PATHCONV=1` — MSYS
 * rewrites any argument that looks like a Unix path, so a bare `ROUTES=/admin`
 * arrives as `C:/Program Files/Git/admin` and every URL built from it is
 * invalid. See the same note in check-mobile.mjs.
 *
 * `check:overflow` and `check:mobile` cover the storefront and stop at the
 * login wall, so the admin — forty-odd routes, all of them behind auth, most of
 * them built around a table — had no phone-width check at all. What that cost:
 *
 *   - Five list pages (Discounts, Waitlist, Inventory, Locations, Staff) shipped
 *     with no mobile layout, so a seven-column table ran to 1,661px inside its
 *     scroll box. The document stayed 390px wide, which is why every existing
 *     check passed it, and the page still read as cut in half — every column
 *     past the first, including the only controls on the row, sat off the right
 *     edge with nothing to say they were there.
 *   - Header action rows wrapped to three lines and ate the fold.
 *
 * So this measures three things a document-width check cannot see:
 *
 *   1. OVERFLOW, the usual way: nothing may make the document wider than the
 *      screen. `overflow-x: clip` on the root (globals.css) hides the symptom,
 *      so the root clip is lifted for the measurement and put back after.
 *
 *   2. CONTENT CLIPPED WITH NO WAY TO REACH IT. An element wider than the
 *      viewport is fine if it sits in something that scrolls — that is what the
 *      `.strip` rows are. It is a bug when the nearest scrollable ancestor is
 *      the page itself, because then the part past the edge is simply gone.
 *
 *   3. A WIDE `<table>` STILL RENDERING ON A PHONE. This is the one that
 *      matters most here, and the one the first two both miss: every offending
 *      table was already inside `overflow-x: auto`, so the document stayed
 *      390px and nothing was technically unreachable. It was still the wrong
 *      layout. `RecordList` / `DesktopTable` is this codebase's answer — the
 *      table is `hidden md:block` and a stack of cards takes the phone — so a
 *      table with a bounding box at phone width has simply not been converted.
 *      `display: none` has no box, which is why the converted pages pass.
 *
 *      Escape hatch: `data-phone-scroll` on the table or any ancestor, for the
 *      genuine case of a wide report whose columns *are* the content and where
 *      swiping sideways is the honest interaction.
 *
 * Drives the Chrome already on the machine; puppeteer-core downloads nothing.
 * Set CHROME_PATH to point at a different binary.
 *
 * Needs `adminlogin` / `adminpassword` in .env.local (gitignored). Skips
 * cleanly when they are absent, so it is safe in a wider check run.
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { loadEnv } from "./db-config.mjs";

loadEnv();

const BASE = process.env.BASE_URL ?? process.env.BASE ?? "http://localhost:3000";
const EMAIL = process.env.adminlogin;
const PASSWORD = process.env.adminpassword;

if (!EMAIL || !PASSWORD) {
  console.log("adminlogin / adminpassword not set in .env.local — skipping.");
  process.exit(0);
}

/** 320 is the narrowest phone still in circulation; 430 the widest common one. */
const WIDTHS = (process.env.WIDTHS ?? "320,390,430").split(",").map(Number);

/** Every admin route that renders a list, a form or a dashboard. */
const ROUTES = (
  process.env.ROUTES ??
  [
    "/admin",
    "/admin/orders",
    "/admin/orders/drafts",
    "/admin/orders/abandoned",
    "/admin/orders/tracking",
    "/admin/orders/new",
    "/admin/products",
    "/admin/products/new",
    "/admin/products/collections",
    "/admin/products/inventory",
    "/admin/products/gift-cards",
    "/admin/products/purchase-orders",
    "/admin/products/transfers",
    "/admin/products/price-lists",
    "/admin/customers",
    "/admin/customers/new",
    "/admin/customers/segments",
    "/admin/customers/companies",
    "/admin/waitlist",
    "/admin/discounts",
    "/admin/content/files",
    "/admin/content/metaobjects",
    "/admin/analytics",
    "/admin/analytics/reports",
    "/admin/analytics/live",
    "/admin/marketing",
    "/admin/marketing/automations",
    "/admin/online-store",
    "/admin/pos",
    "/admin/social-channels",
    "/admin/settings",
    "/admin/settings/general",
    "/admin/settings/payments",
    "/admin/settings/locations",
    "/admin/settings/users",
    "/admin/settings/policies",
    "/admin/settings/brand",
    "/admin/settings/qikink",
  ].join(",")
).split(",");

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

/* -------------------------------------------------------------------------- */
/* In-page probe                                                              */
/* -------------------------------------------------------------------------- */

/** Runs in the page. Returns the document width and any unreachable overhang. */
function probe(viewportWidth) {
  // `overflow-x: clip` on the root is a backstop, not a fix — it stops the
  // panning but leaves the content just as wide. Lift it to measure the truth.
  const rootStyle = document.documentElement.style;
  const bodyStyle = document.body.style;
  const previous = [rootStyle.overflowX, bodyStyle.overflowX];
  rootStyle.overflowX = "visible";
  bodyStyle.overflowX = "visible";

  const documentWidth = Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth
  );

  /** The nearest ancestor that can actually scroll this element sideways. */
  const scrollableAncestor = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const overflowX = getComputedStyle(p).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") {
        // It only counts if it is genuinely scrolled *past* — a container the
        // same width as its content scrolls nowhere.
        if (p.scrollWidth > p.clientWidth + 1) return p;
      }
    }
    return null;
  };

  const clipped = [];
  const reported = new Set();

  for (const el of document.querySelectorAll("main *, header *, nav *")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    // A 1px tolerance: sub-pixel layout rounding is not a bug.
    if (rect.right <= viewportWidth + 1 && rect.left >= -1) continue;

    const style = getComputedStyle(el);
    // Fixed chrome is laid out against the viewport, not the page.
    if (style.position === "fixed") continue;
    // Deliberately off-screen: visually-hidden text, closed drawers.
    if (style.visibility === "hidden" || style.opacity === "0") continue;
    if (scrollableAncestor(el)) continue;

    // Report the outermost offender — its children are the same fault.
    let ancestorReported = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (reported.has(p)) {
        ancestorReported = true;
        break;
      }
    }
    if (ancestorReported) continue;
    reported.add(el);

    clipped.push({
      tag: el.tagName.toLowerCase(),
      classes: (typeof el.className === "string" ? el.className : "").slice(0, 90),
      text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
    });
  }

  // Tables that still have a box at this width, and are wider than the screen.
  const tables = [];
  for (const table of document.querySelectorAll("main table")) {
    const rect = table.getBoundingClientRect();
    // `hidden md:block` collapses the box entirely — that is the pass case.
    if (rect.width === 0 && rect.height === 0) continue;
    if (table.scrollWidth <= viewportWidth) continue;
    if (table.closest("[data-phone-scroll]")) continue;
    tables.push({
      width: Math.round(table.scrollWidth),
      headings: [...table.querySelectorAll("th")]
        .map((th) => th.textContent.trim())
        .filter(Boolean)
        .slice(0, 6)
        .join(", "),
    });
  }

  rootStyle.overflowX = previous[0];
  bodyStyle.overflowX = previous[1];

  return { documentWidth, clipped, tables };
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();

await page.setViewport({ width: 1280, height: 900 });
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

const failures = [];

for (const width of WIDTHS) {
  console.log(`\n\x1b[1m${width}px\x1b[0m`);
  await page.setViewport({
    width,
    height: 844,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });

  for (const route of ROUTES) {
    let result;
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2", timeout: 45000 });
      // Let the client boundaries (search, live counters) settle.
      await new Promise((r) => setTimeout(r, 350));
      result = await page.evaluate(probe, width);
    } catch (error) {
      failures.push(`${route} @ ${width}px — ${error.message}`);
      console.log(`  \x1b[31m✗\x1b[0m ${route}  ${error.message.slice(0, 60)}`);
      continue;
    }

    const overflow = result.documentWidth - width;
    const bad = overflow > 1 || result.clipped.length > 0 || result.tables.length > 0;
    if (!bad) {
      console.log(`  \x1b[32m✓\x1b[0m ${route}`);
      continue;
    }

    failures.push(`${route} @ ${width}px`);
    console.log(
      `  \x1b[31m✗\x1b[0m ${route}` +
        (overflow > 1 ? `  document ${result.documentWidth}px (+${overflow})` : "")
    );
    for (const c of result.clipped.slice(0, 5)) {
      console.log(
        `      ${c.tag}.${c.classes.split(" ").slice(0, 5).join(".")}` +
          `  [${c.left}..${c.right}]  "${c.text}"`
      );
    }
    for (const t of result.tables) {
      console.log(
        `      <table> ${t.width}px on a ${width}px screen — needs a RecordList` +
          (t.headings ? `  (${t.headings})` : "")
      );
    }
  }
}

await browser.close();

if (failures.length) {
  console.error(
    `\n\x1b[31m${failures.length} phone-layout failure(s)\x1b[0m\n  ` +
      failures.join("\n  ")
  );
  process.exit(1);
}
console.log("\n\x1b[32mEvery admin route fits its phone.\x1b[0m");
