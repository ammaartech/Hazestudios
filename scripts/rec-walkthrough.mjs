/**
 * Records the Haze Studios walkthrough from the running app.
 *
 *   node scripts/rec-walkthrough.mjs
 *
 * Captures real frames via CDP screencast while a scripted operator drives the
 * storefront and the admin. Three things are drawn into the page rather than
 * composited afterwards, because the capture has no compositor of its own:
 *
 *   - a pointer, since a screencast does not record the OS cursor;
 *   - a section label, so a silent video is followable;
 *   - the PII blur (see rec-pii-mask.mjs).
 *
 * Writes brag-real/frames/*.jpg plus brag-real/events.json — the event log the
 * assembler uses for speed ramps and for placing interface sounds.
 *
 * WRITES TO THE STORE: exactly one, on TEST_ORDER — a COD advance request that
 * is created and then cancelled in the same run. Nothing else submits.
 */
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { loadEnv } from "./db-config.mjs";
import { fetchPiiTerms, installMask, auditMask } from "./rec-pii-mask.mjs";

loadEnv();

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const EMAIL = process.env.adminlogin;
const PASSWORD = process.env.adminpassword;
const OUT = "brag-real";
const FRAMES = join(OUT, "frames");

/** The order nominated for the one permitted write. */
const TEST_ORDER = process.env.REC_TEST_ORDER ?? "615e5846-d820-4b66-bce1-08dcd9942abb";

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${(process.env.LOCALAPPDATA ?? "").replace(/\\/g, "/")}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean).find((p) => existsSync(p));

if (!CHROME) { console.error("no Chrome found"); process.exit(1); }
if (!EMAIL || !PASSWORD) { console.error("adminlogin / adminpassword missing"); process.exit(1); }

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

/* -------------------------------------------------------------------------- */
/* Overlay: pointer + section label, drawn inside the page                     */
/* -------------------------------------------------------------------------- */

function OVERLAY() {
  // Runs at document-start, where `document.documentElement` can still be
  // null. Appending to it directly throws, and the whole overlay — pointer and
  // label both — silently never installs. So the API is attached first and the
  // DOM is touched only once there is a document to touch.
  const CSS = `
    #hf-cursor {
      position: fixed; left: 0; top: 0; width: 26px; height: 26px;
      z-index: 2147483647; pointer-events: none; will-change: transform;
      transform: translate(-100px, -100px);
      transition: transform 520ms cubic-bezier(.33,.66,.31,1);
      filter: drop-shadow(0 2px 5px rgba(0,0,0,.45));
    }
    #hf-cursor.fast { transition-duration: 260ms; }
    #hf-cursor.press { transform-origin: 3px 3px; }
    /* Clear of the 240px admin sidebar, and a solid pill so it stays legible
       over both the white storefront and the light admin canvas. */
    #hf-label {
      position: fixed; left: 280px; bottom: 34px; z-index: 2147483646;
      display: inline-flex; align-items: center; gap: 12px;
      padding: 12px 20px 12px 16px; border-radius: 10px;
      background: rgba(14, 17, 24, 0.92);
      box-shadow: 0 6px 28px rgba(0,0,0,.28);
      pointer-events: none; opacity: 0; transform: translateY(6px);
      transition: opacity 260ms ease, transform 260ms ease;
      font: 600 24px/1.2 ui-sans-serif, system-ui, sans-serif;
      color: #fff; letter-spacing: -0.01em;
    }
    #hf-label.on { opacity: 1; transform: translateY(0); }
    #hf-label i {
      display: block; width: 4px; height: 26px; background: #4d86ff; border-radius: 2px;
    }
    /* Storefront: no sidebar to clear. */
    #hf-label.dark { left: 40px; }
  `;

  /*
   * These are the last requested states, not a one-shot queue. React can clear
   * the body after the overlay is built, and the rebuild has to restore what
   * the label *said* — an earlier version only replayed a value that had never
   * been applied, so every rebuilt label came back blank.
   */
  let lastLabel = null;
  let lastCursor = null;

  /*
   * Everything goes on `document.body`, never on `document.documentElement`.
   * A <div> as a direct child of <html> is invalid, and React treated it as a
   * hydration mismatch (minified error #418) and discarded the overlay — which
   * is why the first two captures came back with no pointer and no label.
   *
   * React can still replace body children on a re-render, so `build` is
   * idempotent and an observer re-runs it if the nodes go missing.
   */
  function build() {
    if (!document.body) return false;

    if (!document.getElementById("hf-overlay-style")) {
      const style = document.createElement("style");
      style.id = "hf-overlay-style";
      style.textContent = CSS;
      document.body.appendChild(style);
    }

    if (!document.getElementById("hf-cursor")) {
      const cur = document.createElement("div");
      cur.id = "hf-cursor";
      cur.innerHTML =
        '<svg viewBox="0 0 24 24" width="26" height="26">' +
        '<path d="M4 2l7 18 2.6-7.6L21 10z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.body.appendChild(cur);
    }

    if (!document.getElementById("hf-label")) {
      const lab = document.createElement("div");
      lab.id = "hf-label";
      lab.innerHTML = "<i></i><span></span>";
      document.body.appendChild(lab);
    }

    // Always restore the current state onto the freshly built nodes.
    if (lastCursor) applyCursor(...lastCursor);
    if (lastLabel) applyLabel(...lastLabel);
    return true;
  }

  window.__hfOverlayBuild = build;

  function applyCursor(x, y, fast) {
    const c = document.getElementById("hf-cursor");
    if (!c) return false;
    c.classList.toggle("fast", !!fast);
    c.style.transform = `translate(${x}px, ${y}px)`;
    return true;
  }

  function applyLabel(text, dark) {
    const l = document.getElementById("hf-label");
    if (!l) return false;
    if (text) {
      l.querySelector("span").textContent = text;
      l.classList.toggle("dark", !!dark);
      l.classList.add("on");
    } else {
      l.classList.remove("on");
    }
    return true;
  }

  window.__hfCursor = (x, y, fast) => {
    lastCursor = [x, y, fast];
    if (!applyCursor(x, y, fast)) {
      build();
    }
  };
  window.__hfPress = () => {
    const c = document.getElementById("hf-cursor");
    if (!c) return;
    c.animate(
      [{ transform: c.style.transform + " scale(1)" },
       { transform: c.style.transform + " scale(0.72)" },
       { transform: c.style.transform + " scale(1)" }],
      { duration: 200, easing: "ease-out" }
    );
  };
  window.__hfLabel = (text, dark) => {
    lastLabel = [text, dark];
    if (!applyLabel(text, dark)) {
      build();
    }
  };

  /** Lets the driver assert the label really is on screen. */
  window.__hfLabelState = () => {
    const l = document.getElementById("hf-label");
    if (!l) return { present: false };
    return {
      present: true,
      on: l.classList.contains("on"),
      text: l.querySelector("span")?.textContent || "",
    };
  };

  // Built after hydration rather than during it, and re-built if React ever
  // clears the body. Cheap: the observer only acts when a node is actually gone.
  function schedule() {
    build();
    let queued = null;
    new MutationObserver(() => {
      if (queued) return;
      queued = setTimeout(() => {
        queued = null;
        const l = document.getElementById("hf-label");
        if (!l || !document.getElementById("hf-cursor")) { build(); return; }
        // Nodes survived but React may have reset their contents.
        if (lastLabel && lastLabel[0] && l.querySelector("span").textContent !== lastLabel[0]) {
          applyLabel(...lastLabel);
        }
      }, 120);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", () => setTimeout(schedule, 80), { once: true });
}

/* -------------------------------------------------------------------------- */

const events = [];
let t0 = 0;
const now = () => Date.now() - t0;
const log = (type, extra = {}) => events.push({ t: now(), type, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: null,
  args: [
    "--window-size=1920,1080",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--disable-features=CalculateNativeWinOcclusion",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

console.log("loading PII terms…");
const terms = await fetchPiiTerms();
console.log(`  ${terms.names.length} names · ${terms.emails.length} emails · ${terms.phones.length} phones`);

await installMask(page, terms);
await page.evaluateOnNewDocument(OVERLAY);

/* ---- sign in (never filmed) --------------------------------------------- */
console.log("signing in…");
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await page.waitForSelector('input[type="email"]');
await page.type('input[type="email"]', EMAIL);
await page.type('input[type="password"]', PASSWORD);
await Promise.all([
  page.click('button[type="submit"]'),
  page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
]);
if (page.url().includes("/login")) { console.error("sign-in failed"); await browser.close(); process.exit(1); }

/* ---- pre-warm, so no route pays its cold cost on camera ------------------ */
const WARM = [
  "/", "/collections/limited-offers", "/products/rockleejeans", "/cart", "/checkout",
  "/admin", "/admin/orders", `/admin/orders/${TEST_ORDER}`,
  "/admin/orders/tracking/qikink", "/admin/orders/tracking/bluedart",
  "/admin/orders/tracking/delhivery", "/admin/settings/shipping",
  "/admin/products", "/admin/products/collections", "/admin/products/inventory",
  "/admin/customers", "/admin/customers/segments",
  "/admin/analytics", "/admin/analytics/reports",
  "/admin/discounts", "/admin/content/files", "/admin/pos", "/admin/online-store",
];
console.log(`pre-warming ${WARM.length} routes…`);
for (const r of WARM) {
  const t = Date.now();
  await page.goto(`${BASE}${r}`, { waitUntil: "networkidle2", timeout: 90000 }).catch(() => {});
  process.stdout.write(`  ${r} ${Date.now() - t}ms\n`);
}

/* ---- helpers ------------------------------------------------------------- */

/*
 * Section labels are NOT drawn in the page any more.
 *
 * They were, and they worked in isolation — present, opacity 1, correctly
 * positioned on every route — but they did not survive into the screencast,
 * and five captures were spent chasing that. The label text is only ever
 * needed at assembly time, so it is logged here and burned in afterwards from
 * events.json, where nothing in the page can interfere with it.
 *
 * The pointer stays in-page: it is positional, so it has to be.
 */
const label = async (text, dark = false) => {
  if (text) log("label", { text, dark });
  else log("label-off");
};

/** Moves the drawn pointer to an element's centre, then optionally clicks it. */
async function point(selector, { click = false, fast = false, settle = 620 } = {}) {
  const box = await page
    .$eval(selector, (el) => {
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })
    .catch(() => null);
  if (!box) return false;
  await page.evaluate((x, y, f) => window.__hfCursor && window.__hfCursor(x, y, f), box.x, box.y, fast);
  await sleep(settle);
  if (click) {
    await page.evaluate(() => window.__hfPress && window.__hfPress());
    log("click");
    await page.click(selector).catch(() => {});
    await sleep(260);
  }
  return true;
}

/**
 * Points at a control by its visible label. The admin's buttons carry no ids
 * or test hooks, and their generated Radix ids change per render, so the label
 * is the only stable handle.
 */
async function pointText(text, opts = {}) {
  const sel = await page.evaluate((t) => {
    document.querySelectorAll("[data-hf-target]").forEach((e) => e.removeAttribute("data-hf-target"));
    const el = [...document.querySelectorAll("button, a, [role=button]")].find(
      (e) => (e.innerText || "").trim() === t
    );
    if (!el) return null;
    el.setAttribute("data-hf-target", "1");
    return '[data-hf-target="1"]';
  }, text);
  if (!sel) {
    console.log(`    (no control labelled "${text}")`);
    return false;
  }
  return point(sel, opts);
}

/** Smooth wheel scroll, so the capture sees motion rather than a jump cut. */
async function scroll(distance, steps = 26, pause = 26) {
  const per = distance / steps;
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), per);
    await sleep(pause);
  }
}

async function typeInto(selector, text, delay = 62) {
  const ok = await point(selector, { click: true, fast: true, settle: 320 });
  if (!ok) return;
  for (const ch of text) {
    await page.type(selector, ch, { delay: 0 }).catch(() => {});
    log("key");
    await sleep(delay);
  }
}

/*
 * `networkidle2` only means the requests stopped; these pages then sit on
 * Suspense skeletons while the real content streams in. Waiting on the
 * skeletons to clear is what makes the capture dwell on content — without it
 * the screencast's frames are nearly all placeholder, and the admin half of
 * the first cut was loading bars held for sixteen seconds a time.
 */
async function settled(extra = 900) {
  await page
    .waitForFunction(() => !document.querySelector('[data-slot="skeleton"]'), { timeout: 30000 })
    .catch(() => {});
  await sleep(extra);
}

async function go(route, { wait = 900 } = {}) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2", timeout: 90000 }).catch(() => {});
  await page.evaluate(() => window.__hfSweep && window.__hfSweep()).catch(() => {});
  // The overlay is rebuilt on load; put the section label back on it.
  await page.evaluate(() => window.__hfOverlayBuild && window.__hfOverlayBuild()).catch(() => {});
  await settled(wait);
}

/* ---- start the camera ---------------------------------------------------- */

const client = await page.createCDPSession();
let frameIndex = 0;
const frameMeta = [];
const writes = [];

client.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
  const i = frameIndex++;
  frameMeta.push({ i, t: now(), ts: metadata?.timestamp ?? null });
  writes.push(writeFile(join(FRAMES, `${String(i).padStart(6, "0")}.jpg`), Buffer.from(data, "base64")));
  client.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

console.log("\nrecording…");
t0 = Date.now();
await client.send("Page.startScreencast", {
  format: "jpeg",
  quality: 92,
  maxWidth: 1920,
  maxHeight: 1080,
  everyNthFrame: 1,
});

/* ======================= ACT ONE — the storefront ========================= */

await go("/", { wait: 1200 });
await label("Storefront", true);
log("section", { name: "storefront-home", speed: 1.7 });
await sleep(1400);
await scroll(2600, 40, 24);
await sleep(700);
await scroll(2400, 36, 24);
await sleep(900);

/*
 * `fall-2025` from home-content.ts does not exist in this database, which is
 * why the home rails render empty — loadBlock drops a block whose collection
 * is missing. These are handles that actually resolve and carry products.
 */
log("section", { name: "collection", speed: 1.6 });
await label("Collection · 30 products", true);
await go("/collections/limited-offers", { wait: 1400 });
await sleep(1200);
await scroll(1800, 30, 26);
await sleep(900);

log("section", { name: "product", speed: 1.0 });
await label("Product page", true);
await go("/products/rockleejeans", { wait: 1600 });
await sleep(1300);
await scroll(520, 14, 30);
await sleep(700);
// Size, then add to cart. The add button reads "Select option" until a size is
// chosen, so the size click has to land first.
await pointText("Medium", { click: true, settle: 820 });
await sleep(1000);
const added =
  (await pointText("Add to cart", { click: true, settle: 860 })) ||
  (await pointText("Add to bag", { click: true, settle: 860 })) ||
  (await pointText("Select option", { click: true, settle: 860 }));
console.log(`  add-to-cart: ${added ? "clicked" : "NOT FOUND"}`);
await sleep(1800);

log("section", { name: "cart", speed: 1.4 });
await label("Cart", true);
await go("/cart", { wait: 1200 });
await sleep(1500);

log("section", { name: "checkout", speed: 1.2 });
await label("Checkout \u00b7 India-first address", true);
await go("/checkout", { wait: 1400 });
await scroll(420, 12, 30);
await sleep(600);
// Fill only — the run never submits payment, so no real order is created.
for (const [sel, val] of [
  ["input[name='first_name'], input[autocomplete='given-name']", "Arun"],
  ["input[name='last_name'], input[autocomplete='family-name']", "Mehta"],
  ["input[name='address1'], input[autocomplete='address-line1']", "14 Marine Lines"],
  ["input[name='zip'], input[autocomplete='postal-code']", "400001"],
]) {
  await typeInto(sel, val, 58);
  await sleep(260);
}
await sleep(1600);

/* ========================= ACT TWO — the admin ============================ */

log("section", { name: "admin-home", speed: 1.3 });
await label("Admin \u00b7 Home");
await go("/admin", { wait: 2200 });
await sleep(2200);
await scroll(900, 20, 30);
await sleep(1400);

log("section", { name: "orders", speed: 1.3 });
await label("Orders \u00b7 6,768 of them");
await go("/admin/orders", { wait: 1400 });
await sleep(1500);
await scroll(1400, 26, 26);
await sleep(900);
await scroll(-1400, 20, 20);
await sleep(700);

/*
 * Partial COD \u2014 the centrepiece, and the only part of the run that writes.
 * The order already carries a live request ("Watching for payment"), so the
 * feature's steady state is filmed first. Then one new request is created and
 * withdrawn again, so the video shows the interaction actually landing rather
 * than only its result. Nothing else in the run submits anything.
 */
log("section", { name: "partial-cod", speed: 1.0 });
await label("Partial COD \u00b7 advance before dispatch");
await go(`/admin/orders/${TEST_ORDER}`, { wait: 1800 });
await sleep(1500);
await scroll(380, 12, 32);
await sleep(1400);

// The existing open request, with its share and settle controls.
await pointText("Request partial COD", { settle: 900 });
await sleep(1100);

// --- the one write: create a request, then withdraw it ---------------------
log("write-begin", { order: TEST_ORDER });
if (await pointText("Request partial COD", { click: true, settle: 900 })) {
  await sleep(1200);
  // The dialog's amount field, whatever it is called.
  for (const sel of [
    "#adv-amount",
    "input[name='amount']",
    "[role=dialog] input[type='number']",
    "[role=dialog] input[type='text']",
  ]) {
    if (await page.$(sel)) {
      await page.click(sel, { clickCount: 3 }).catch(() => {});
      for (const ch of "250") {
        await page.type(sel, ch, { delay: 0 }).catch(() => {});
        log("key");
        await sleep(110);
      }
      break;
    }
  }
  await sleep(1000);

  const submitted =
    (await pointText("Send request", { click: true, settle: 800 })) ||
    (await pointText("Request advance", { click: true, settle: 800 })) ||
    (await pointText("Create request", { click: true, settle: 800 })) ||
    (await pointText("Send", { click: true, settle: 800 }));

  await sleep(2200);
  log("write-submitted", { ok: !!submitted });

  // Put it back exactly as it was found.
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(600);
  await go(`/admin/orders/${TEST_ORDER}`, { wait: 1600 });
  const withdrawn = await pointText("Withdraw request", { click: true, settle: 820 });
  await sleep(1400);
  // Some builds confirm the withdrawal in a dialog.
  await pointText("Withdraw", { click: true, settle: 600 });
  await sleep(1200);
  log("write-reverted", { ok: !!withdrawn });
  console.log(`  write: submitted=${!!submitted} withdrawn=${!!withdrawn}`);
} else {
  console.log("  write skipped \u2014 no 'New request' control found");
  log("write-skipped");
}
await sleep(1200);

log("section", { name: "couriers", speed: 1.5 });
await label("Five couriers, one interface");
for (const c of ["qikink", "bluedart", "delhivery"]) {
  await go(`/admin/orders/tracking/${c}`, { wait: 1100 });
  await sleep(1300);
}
await label("Shipping settings");
await go("/admin/settings/shipping", { wait: 1200 });
await scroll(1100, 22, 28);
await sleep(900);
await scroll(-1100, 18, 24);
await sleep(900);

log("section", { name: "products", speed: 1.4 });
await label("Products \u00b7 497 live");
await go("/admin/products", { wait: 1300 });
await sleep(1300);
await scroll(1200, 22, 26);
await sleep(800);
const firstAdminProduct = await page
  .$eval("a[href*='/admin/products/']", (a) => a.getAttribute("href"))
  .catch(() => null);
if (firstAdminProduct && !firstAdminProduct.endsWith("/products")) {
  await label("Product editor");
  await go(firstAdminProduct, { wait: 1600 });
  await sleep(1500);
  await scroll(1500, 26, 28);
  await sleep(1100);
}

log("section", { name: "catalogue", speed: 1.6 });
await label("Collections \u00b7 smart rules");
await go("/admin/products/collections", { wait: 1200 });
await sleep(1200);
await label("Inventory");
await go("/admin/products/inventory", { wait: 1200 });
await sleep(1200);

log("section", { name: "customers", speed: 1.6 });
await label("Customers \u00b7 segments");
await go("/admin/customers", { wait: 1200 });
await sleep(1200);
await scroll(900, 18, 28);
await go("/admin/customers/segments", { wait: 1100 });
await sleep(1100);

log("section", { name: "analytics", speed: 1.2 });
await label("Analytics");
await go("/admin/analytics", { wait: 1600 });
await sleep(1200);
// The default window is the last 30 days, which on this store is genuinely
// quiet (5 orders). Widening it on camera shows the real shape of the data
// rather than a flat line — a read-only control change, nothing is written.
if (await pointText("Last 30 days", { click: true, settle: 700 })) {
  await sleep(900);
  for (const opt of ["Last 12 months", "Last 90 days", "Last year"]) {
    if (await pointText(opt, { click: true, settle: 640 })) break;
  }
  await sleep(2200);
}
await sleep(1200);
await scroll(1000, 20, 30);
await sleep(900);
await label("Reports \u00b7 SQL, with CSV out");
await go("/admin/analytics/reports", { wait: 1400 });
await sleep(1600);
await scroll(900, 18, 28);
await sleep(1000);

log("section", { name: "rest", speed: 1.7 });
await label("Discounts");
await go("/admin/discounts", { wait: 1000 });
await sleep(1000);
await label("Content \u00b7 files");
await go("/admin/content/files", { wait: 1000 });
await sleep(1000);
await label("Point of sale");
await go("/admin/pos", { wait: 1000 });
await sleep(1000);
await label("Online store");
await go("/admin/online-store", { wait: 1000 });
await sleep(1200);

await label(null);
await sleep(900);

/* ---- stop ---------------------------------------------------------------- */

await client.send("Page.stopScreencast").catch(() => {});
await Promise.all(writes);

const audit = await auditMask(page, "final");
const captureMs = now();

writeFileSync(
  join(OUT, "events.json"),
  JSON.stringify({ captureMs, frames: frameMeta, events }, null, 2)
);

await browser.close();

console.log(`\ncaptured ${frameMeta.length} frames over ${(captureMs / 1000).toFixed(1)}s`);
console.log(`sections: ${events.filter((e) => e.type === "section").length}`);
console.log(`clicks: ${events.filter((e) => e.type === "click").length} · keys: ${events.filter((e) => e.type === "key").length}`);
console.log(`final-page PII leaks: ${audit.leaks.length}`);
console.log(`\nframes -> ${FRAMES}/`);
console.log(`events -> ${join(OUT, "events.json")}`);
