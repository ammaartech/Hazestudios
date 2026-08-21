/**
 * Sweeps every admin page and reports what is slow or hard to read.
 *
 *   npm run audit:admin
 *
 * Runs against a PRODUCTION server (`npm run build && npm start`). Dev-server
 * timings measure on-demand compilation, not the app, and would send you
 * optimising the wrong thing.
 *
 * Per route it reports:
 *
 *   ready    — when the page's <h1> exists. The honest "I can start reading
 *              this" moment, and the one Suspense boundaries actually change;
 *              `load` fires before streamed content arrives and flatters a page
 *              that is still a skeleton.
 *   bytes    — everything the network handed over, from the Resource Timing API.
 *   nodes    — DOM size. A list page rendering thousands of nodes is a list
 *              page with no page size.
 *   issues   — contrast below WCAG AA, text under 12px, tap targets under 24px,
 *              horizontal overflow, and console errors.
 *
 * Contrast is computed against the nearest ancestor that actually paints a
 * background, which is the part naive checkers get wrong — they read
 * `transparent` off the element itself and score everything as pass.
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { loadEnv } from "./db-config.mjs";

loadEnv();

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.adminlogin;
const PASSWORD = process.env.adminpassword;
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("-"));
/** `WIDTH=390 npm run audit:admin` to sweep at phone size. */
const WIDTH = Number(process.env.WIDTH ?? 1600);

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

const ROUTES = [
  "/admin",
  "/admin/orders",
  "/admin/orders/drafts",
  "/admin/orders/abandoned",
  "/admin/orders/tracking",
  "/admin/orders/new",
  "/admin/products",
  "/admin/products/collections",
  "/admin/products/inventory",
  "/admin/products/gift-cards",
  "/admin/products/purchase-orders",
  "/admin/products/transfers",
  "/admin/products/price-lists",
  "/admin/customers",
  "/admin/customers/segments",
  "/admin/customers/companies",
  "/admin/customers/new",
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
  "/admin/settings/shipping",
].filter((r) => !ONLY.length || ONLY.some((o) => r.includes(o)));

/* -------------------------------------------------------------------------- */
/* In-page audit                                                              */
/* -------------------------------------------------------------------------- */

const AUDIT = () => {
  const srgb = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };

  /*
   * Colours are resolved by painting them, not by parsing them.
   *
   * Tailwind v4 emits `oklch()`, and Chrome keeps that syntax in the computed
   * style rather than normalising to `rgb()`. A regex that pulls the first
   * three numbers out of a colour string therefore reads `oklch(0.92 0.05 96)`
   * as if it were an RGB triple, which is not merely imprecise — it invents
   * failures. It scored `bg-amber-100 text-amber-900`, a genuinely comfortable
   * 8.9:1, as 1.18:1.
   *
   * Compositing onto a 1×1 canvas and reading the pixel back delegates the
   * whole problem to the engine: any colour syntax it can parse, including
   * alpha, comes back as the sRGB the user actually sees.
   */
  const ctx = document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  });

  const paint = (color, base) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };

  /** True when a colour would paint nothing at all (transparent). */
  const opaqueEnough = (color) => {
    const onBlack = paint(color, [0, 0, 0]);
    const onWhite = paint(color, [255, 255, 255]);
    // Identical over both grounds ⇒ fully opaque; wildly different ⇒ see-through.
    return onBlack.every((v, i) => Math.abs(v - onWhite[i]) < 8);
  };

  // The effective background: composite every painting ancestor down onto white.
  const backdrop = (el) => {
    const chain = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        chain.push(bg);
        if (opaqueEnough(bg)) break;
      }
    }
    let base = [255, 255, 255];
    for (const bg of chain.reverse()) base = paint(bg, base);
    return base;
  };

  const issues = [];
  const seen = new Set();
  const push = (kind, el, detail) => {
    const key = `${kind}:${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({
      kind,
      detail,
      text: (el.textContent ?? "").trim().slice(0, 48).replace(/\s+/g, " "),
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 70),
    });
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return (
      r.width > 0 && r.height > 0 &&
      cs.visibility !== "hidden" && cs.display !== "none" &&
      parseFloat(cs.opacity) > 0.05
    );
  };

  for (const el of document.querySelectorAll("main *, header *")) {
    if (!visible(el)) continue;

    // Only elements holding their own text.
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join("");

    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);

    if (own.length > 1) {
      const ground = backdrop(el);
      const r = ratio(paint(cs.color, ground), ground);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      if (r < need) push("contrast", el, `${r.toFixed(2)}:1 (needs ${need}) at ${size}px`);
      if (size < 12) push("tiny-text", el, `${size}px`);
    }

    // Tap targets.
    if (/^(button|a)$/.test(el.tagName.toLowerCase()) || el.getAttribute("role") === "button") {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.height < 24 || r.width < 24)) {
        push("small-target", el, `${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
  }

  return {
    issues,
    nodes: document.querySelectorAll("*").length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bytes: performance.getEntriesByType("resource")
      .reduce((n, r) => n + (r.transferSize || 0), 0),
    h1: document.querySelector("main h1")?.textContent?.trim().slice(0, 40) ?? null,
    rows: document.querySelectorAll("tbody tr").length,
    // A table wider than its own scroll box: readable on a desktop, a
    // side-swipe hunt on a phone.
    wideTables: [...document.querySelectorAll('[data-slot="table-container"]')]
      .filter((el) => el.scrollWidth > el.clientWidth + 4)
      .map((el) => el.scrollWidth - el.clientWidth).length,
  };
};

/* -------------------------------------------------------------------------- */

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: WIDTH < 600 ? 844 : 1000 });

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

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const results = [];

for (const route of ROUTES) {
  const errors = [];
  const onError = (m) => m.type() === "error" && errors.push(m.text().slice(0, 120));
  page.on("console", onError);

  const started = Date.now();
  let ready = null;
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Not `h1`: the settings pages render a form with no heading at all (which
    // is itself a finding). Wait for the page to have real content instead.
    await page.waitForFunction(
      () => (document.querySelector("main")?.innerText ?? "").trim().length > 40,
      { timeout: 25000 }
    );
    ready = Date.now() - started;
    // Let streamed content and images settle before auditing.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 700)));
  } catch {
    ready = null;
  }

  const a = ready === null ? null : await page.evaluate(AUDIT);
  page.off("console", onError);
  results.push({ route, ready, errors, ...(a ?? {}) });
}

await browser.close();

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

const slow = (ms) => (ms === null ? c.red("FAILED") : ms > 2500 ? c.red(`${ms}ms`) : ms > 1200 ? c.yellow(`${ms}ms`) : c.green(`${ms}ms`));

console.log(c.bold("\nRoute                                ready     bytes   nodes  rows  issues"));
console.log(c.dim("".padEnd(78, "─")));

for (const r of results) {
  const n = r.issues?.length ?? 0;
  console.log(
    `${r.route.padEnd(36)} ${slow(r.ready).padStart(16)} ` +
      `${String(Math.round((r.bytes ?? 0) / 1024) + "kb").padStart(8)} ` +
      `${String(r.nodes ?? "-").padStart(6)} ${String(r.rows ?? "-").padStart(5)}  ` +
      (n ? c.yellow(String(n)) : c.green("0")) +
      (r.overflow > 0 ? c.red(`  OVERFLOW +${r.overflow}px`) : "") +
      (r.wideTables ? c.yellow(`  ${r.wideTables} side-scrolling table(s)`) : "") +
      (r.errors?.length ? c.red(`  ${r.errors.length} console errors`) : "")
  );
}

// Group issues by kind + detail so the same class of defect reads as one line.
const byKind = new Map();
for (const r of results) {
  for (const i of r.issues ?? []) {
    const key = `${i.kind}|${i.detail}|${i.cls}`;
    const hit = byKind.get(key) ?? { ...i, routes: [] };
    if (!hit.routes.includes(r.route)) hit.routes.push(r.route);
    byKind.set(key, hit);
  }
}

const ranked = [...byKind.values()].sort((a, b) => b.routes.length - a.routes.length);
if (ranked.length) {
  console.log(c.bold(`\nIssues — ${ranked.length} distinct, most widespread first\n`));
  for (const i of ranked.slice(0, 30)) {
    console.log(
      `  ${c.yellow(i.kind.padEnd(13))} ${i.detail.padEnd(30)} ${c.dim(`×${i.routes.length}`)}`
    );
    console.log(c.dim(`      <${i.tag}> "${i.text}"`));
    console.log(c.dim(`      ${i.cls}`));
  }
}

for (const r of results) {
  if (r.errors?.length) {
    console.log(c.red(`\n${r.route} console errors:`));
    for (const e of [...new Set(r.errors)].slice(0, 5)) console.log(c.dim(`  ${e}`));
  }
}
console.log("");
