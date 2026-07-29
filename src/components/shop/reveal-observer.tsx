"use client";

import { useEffect } from "react";

/** Set once an element has entered; the CSS animation keys off it. */
const REVEALED = "data-reveal-in";

/**
 * The one piece of JavaScript behind every scroll entrance on the storefront.
 *
 * One `IntersectionObserver` for the whole document rather than one per
 * section: fifty observers watching fifty cards is fifty sets of thresholds
 * for the browser to reconcile on every scroll, and they all want the same
 * answer. Elements are unobserved the moment they arrive, so the set only ever
 * shrinks as the shopper moves down the page.
 *
 * Reveals are one-shot. A section that faded back out on the way up would make
 * the page feel unstable — and re-running the animation on every pass is work
 * for an effect the shopper has already seen.
 *
 * `data-reveal-active` is set from here, and only from here. Until it lands the
 * hidden state in CSS does not apply, so the interval before hydration shows
 * the fully rendered page rather than an empty one. That also means the
 * reduced-motion branch needs no CSS of its own: returning early leaves the
 * attribute unset and the whole system inert.
 */
export function RevealObserver() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".shop");
    if (!root) return;

    // Honour the preference by never arming the system, rather than by
    // animating to a zero duration. Nothing is hidden and nothing is observed.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    root.setAttribute("data-reveal-active", "");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute(REVEALED, "");
          observer.unobserve(entry.target);
        }
      },
      {
        // Held back from the very bottom edge so a section starts moving once
        // it is properly on screen, not as its first pixel clips the fold.
        rootMargin: "0px 0px -12% 0px",
        threshold: 0.01,
      }
    );

    const scan = () => {
      for (const el of root.querySelectorAll(`[data-reveal]:not([${REVEALED}])`)) {
        // Re-observing an existing target is a no-op, so overlapping scans are
        // free and the selector above keeps finished elements out entirely.
        observer.observe(el);
      }
    };

    scan();

    // Route changes swap the contents of `main` underneath this effect, and
    // streamed markup can land after it has already run. Watching the subtree
    // covers both without tying the scan to a router hook — an element that
    // appears late still gets its entrance instead of staying hidden forever.
    let queued = false;
    const mutations = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        scan();
      });
    });
    mutations.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutations.disconnect();
      root.removeAttribute("data-reveal-active");
    };
  }, []);

  return null;
}
