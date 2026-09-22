/**
 * Content-based PII masking for the walkthrough recording.
 *
 * Masking by coordinates does not survive a table that scrolls, and masking by
 * CSS selector only covers the pages someone remembered to write a rule for.
 * This instead takes the real names, emails and phone numbers out of the
 * database and blurs any element that renders one, on every page, re-applying
 * as the DOM changes.
 *
 * The important property is that it is *checkable*: `auditMask` re-runs the
 * same search after masking and reports anything still visible, so coverage is
 * a measured number rather than a hope.
 *
 * Terms stay in memory. They are never written to disk or into the video.
 */
import pg from "pg";
import { dbConfig } from "./db-config.mjs";

/** Pulls every string that would identify a real person. */
export async function fetchPiiTerms() {
  const db = new pg.Client(dbConfig());
  await db.connect();

  const names = new Set();
  const emails = new Set();
  const phones = new Set();

  const add = (set, v) => {
    const s = (v ?? "").toString().trim();
    if (s.length >= 3) set.add(s.toLowerCase());
  };

  const customers = await db.query(
    `select first_name, last_name, email, phone from customers limit 20000`
  );
  for (const r of customers.rows) {
    const f = (r.first_name ?? "").trim();
    const l = (r.last_name ?? "").trim();
    if (f) add(names, f);
    if (l) add(names, l);
    if (f && l) add(names, `${f} ${l}`);
    add(emails, r.email);
    add(phones, r.phone);
  }

  // Orders carry their own snapshot of the buyer, which can differ from the
  // customer record (guest checkouts, edited addresses).
  const orders = await db
    .query(`select email, phone from orders limit 20000`)
    .catch(() => ({ rows: [] }));
  for (const r of orders.rows) {
    add(emails, r.email);
    add(phones, r.phone);
  }

  const addresses = await db
    .query(
      `select name, first_name, last_name, phone, address1, address2, city, zip
         from addresses limit 20000`
    )
    .catch(() => ({ rows: [] }));
  for (const r of addresses.rows) {
    const f = (r.first_name ?? "").trim();
    const l = (r.last_name ?? "").trim();
    if (f) add(names, f);
    if (l) add(names, l);
    if (f && l) add(names, `${f} ${l}`);
    add(names, r.name);
    add(phones, r.phone);
    add(names, r.address1);
    add(names, r.address2);
  }

  await db.end();

  // Single very common words would blur half the interface ("one", "new").
  const STOP = new Set([
    "one", "new", "test", "admin", "order", "the", "and", "for", "home",
    "shop", "store", "user", "guest", "none", "null", "customer", "default",
  ]);
  for (const w of [...names]) if (STOP.has(w) || w.length < 4) names.delete(w);

  return {
    names: [...names],
    emails: [...emails],
    phones: [...phones],
  };
}

/**
 * The function that runs inside the page. Declared standalone so it can be
 * handed to both `evaluateOnNewDocument` (covers navigations) and `evaluate`
 * (covers the page already open).
 */
function MASKER(terms) {
  const NAMES = new Set(terms.names);
  const EMAILS = new Set(terms.emails);
  const PHONES = new Set(terms.phones);

  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  // Indian mobile numbers, with or without +91, spaces or dashes.
  const PHONE_RE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/;

  // This runs at document-start, where `document.head` and even
  // `document.documentElement` can still be null — so nothing here may touch
  // the DOM until `boot()`. Getting that wrong throws before the sweep
  // functions are attached, and the mask silently never installs.
  function ensureStyle() {
    // Body, not head: Next renders <head> through React, and injecting there
    // showed up as a hydration mismatch that discarded the node.
    if (!document.body || document.getElementById("hf-pii-style")) return;
    const style = document.createElement("style");
    style.id = "hf-pii-style";
    style.textContent = `
      .hf-pii {
        filter: blur(7px) !important;
        user-select: none !important;
      }
    `;
    document.body.appendChild(style);
  }

  const CHROME_SEL =
    "button, [role=button], nav, [role=navigation], th, thead, label, " +
    "[role=tab], [role=menuitem], [cmdk-item], select, option";

  const digitsOnly = (s) => s.replace(/[^\d]/g, "");

  function isPii(raw) {
    const t = raw.trim();
    if (t.length < 4) return false;
    const low = t.toLowerCase();

    if (NAMES.has(low) || EMAILS.has(low)) return true;
    if (EMAIL_RE.test(t)) return true;

    const d = digitsOnly(t);
    if (d.length >= 10 && (PHONES.has(low) || PHONES.has(d) || PHONE_RE.test(t))) return true;

    // A cell may wrap the name in other text ("Ships to Priya Raman").
    const words = low.split(/[^a-z0-9@._-]+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      if (NAMES.has(words[i])) return true;
      if (i + 1 < words.length && NAMES.has(`${words[i]} ${words[i + 1]}`)) return true;
    }
    return false;
  }

  window.__hfIsPii = isPii;

  /*
   * Only the admin renders customer data. Running the mask on the storefront
   * gained nothing and cost accuracy: a customer surname collided with a
   * product title and blurred "Sea Shell Skirt" on the shop page. Scope is
   * re-checked per sweep because client-side navigation changes the path
   * without reloading.
   */
  function inScope() {
    return location.pathname.startsWith("/admin");
  }

  function sweep() {
    if (!document.body) return 0;
    if (!inScope()) return 0;
    ensureStyle();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const targets = [];
    let n;
    while ((n = walker.nextNode())) {
      const el = n.parentElement;
      if (!el) continue;
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TITLE") continue;
      if (el.closest(".hf-pii")) continue;
      // Interface chrome never renders a customer, but short surnames do
      // collide with control labels — a customer named "More" was blurring the
      // "More actions" button.
      if (el.closest(CHROME_SEL)) continue;
      if (!isPii(n.textContent)) continue;
      targets.push(el);
    }
    for (const el of targets) el.classList.add("hf-pii");
    return targets.length;
  }

  window.__hfSweep = sweep;

  /** Counts what a viewer could still read. Used by the coverage assertion. */
  window.__hfAudit = () => {
    const leaks = [];
    if (!document.body || !inScope()) return leaks;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const el = n.parentElement;
      if (!el) continue;
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TITLE") continue;
      if (el.closest(".hf-pii")) continue; // already blurred
      if (el.closest(CHROME_SEL)) continue; // interface chrome, not data
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      if (!el.getClientRects().length) continue; // not painted
      if (isPii(n.textContent)) leaks.push(n.textContent.trim().slice(0, 40));
    }
    return leaks;
  };

  // React re-renders constantly; re-sweep on a short debounce.
  let queued = null;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = setTimeout(() => {
      queued = null;
      sweep();
    }, 60);
  });

  function boot() {
    if (!document.body) return;
    sweep();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}

/** Installs the mask so it survives every navigation on this page. */
export async function installMask(page, terms) {
  await page.evaluateOnNewDocument(MASKER, terms);
  await page.evaluate(MASKER, terms).catch(() => {});
}

/** Re-applies after a navigation settles, then reports what is still readable. */
export async function auditMask(page, label = "") {
  await page.evaluate(() => window.__hfSweep && window.__hfSweep()).catch(() => {});
  const leaks = await page.evaluate(() => (window.__hfAudit ? window.__hfAudit() : ["mask not installed"]));
  return { label, leaks };
}
