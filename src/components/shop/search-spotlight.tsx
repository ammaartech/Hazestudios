"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";

/**
 * Spotlight search — the bar behind the header's magnifier.
 *
 * Modelled on the macOS launcher, and the important part of that model is what
 * it does *not* do: it never takes you anywhere to search. The magnifier used to
 * be a link to `/search`, so reaching for search meant abandoning whatever page
 * you were reading. This floats over that page instead, from anywhere, and hands
 * the term to `/search` only once there is one — so a shopper who opens it, sees
 * the bar and changes their mind is exactly where they were.
 *
 * One pill, nothing under it. `/search` already renders results properly, with a
 * URL that can be shared and indexed; duplicating that into a dropdown here
 * would be a second, worse results page competing with the real one.
 *
 * Mounted only while open — closing unmounts it, so the next press builds a
 * fresh bar rather than reopening onto the last thing typed into it.
 */
export function SearchSpotlight({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  /**
   * The term being searched, held while the bar closes on it.
   *
   * Doubles as the "already submitted" flag, so a second Enter during the
   * animation cannot fire a second navigation — and the query is captured here
   * rather than re-read at the end, so what gets searched is what was on screen
   * when the key was pressed.
   */
  const [submitted, setSubmitted] = useState<string | null>(null);

  const query = term.trim();

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    // Enter, and the "Search" key on a phone keyboard, which reports the same.
    if (event.key === "Enter" && query && !submitted) {
      event.preventDefault();
      setSubmitted(query);
    }
  }

  /**
   * Navigation waits for the close to finish, so the gesture is never cut off
   * halfway by the route change.
   *
   * Driven by `animationend` rather than a timeout: a timeout would be a second
   * copy of the duration living in JS, free to drift the moment the CSS is
   * retuned. Swapping the `animation` property cancels the entrance rather than
   * ending it — `animationcancel` fires, not `animationend` — so the only event
   * that can reach this while `submitted` is set is the close finishing.
   */
  function onAnimationEnd() {
    if (!submitted) return;
    onClose();
    router.push(`/search?q=${encodeURIComponent(submitted)}`);
  }

  /*
   * Portalled to the body, because the header is `position: sticky` with a
   * z-index — that makes it a stacking context, and a panel mounted inside it
   * could never paint above the tab bar or the bag drawer whatever layer it
   * claimed.
   *
   * The `shop` wrapper is not decoration. The whole storefront design system is
   * written as `.shop .glass`, `.shop .glass-pill`, `.shop .layer-sheet`, and
   * the palette tokens live on `.shop` too — all of it needs that ancestor to
   * match. Leaving the portal on a bare `<body>` child put the bar outside the
   * only scope those rules exist in, so it rendered as unstyled text on no
   * surface at all. Re-declaring the scope here is what carries the material
   * across the portal boundary.
   *
   * The layer goes on the child rather than on this wrapper, since the rules
   * are descendant selectors and would not match the element declaring `.shop`.
   *
   * `display: contents` keeps the wrapper from generating a box of its own, so
   * it is purely a scope carrier: no second full-width `.shop` block in the
   * body's flex column, and no `overflow-x: clip` box between the overlay and
   * the viewport it is positioned against.
   */
  return createPortal(
    <div className="shop contents">
      <div className="fixed inset-0 layer-sheet">
        {/* Dimmed rather than blurred to the same depth as the bag drawer: this
            sits over the page for a couple of seconds, and the page underneath
            should stay readable enough that closing feels like returning rather
            than reloading. */}
        <button
          type="button"
          aria-label="Close search"
          onClick={onClose}
          className="absolute inset-0 cursor-default bg-black/25 backdrop-blur-[6px]"
          style={{ animation: "cart-scrim 240ms ease-out" }}
        />

        {/*
          Centred with `mx-auto` and not with a translate, because the entrance
          animates `transform` — a centring transform would be the first thing
          the keyframe overwrote.

          `dvh`, not `vh`, per the rest of the shell: on mobile `vh` is measured
          against the viewport with the URL bar hidden, so a `vh` offset sits
          lower on load than it looks. Held high on both so the bar clears the
          on-screen keyboard once the field takes focus.

          `--glass-tint-strong` overrides the base material's 62% tint. Every
          other glass surface floats somewhere predictable — the header over the
          top of the page, the tab bar over the bottom — but this one can land
          on anything: a dark campaign photograph, a product shot, bare white.
          At 62% the placeholder disappeared into whatever was behind it. 80% is
          the token the system already reserves for exactly this, "keep it
          legible when the blur cannot do it alone", and a utility beats
          `.shop .glass` here without a specificity fight because Tailwind's
          utilities layer is ordered after components.
        */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          className="glass glass-pill absolute inset-x-4 top-[22dvh] mx-auto flex max-w-lg items-center gap-3 bg-(--glass-tint-strong) px-5 md:top-[28dvh]"
          style={{
            animation: submitted
              ? "spotlight-submit 260ms cubic-bezier(0.4, 0, 1, 1) both"
              : "spotlight-in 320ms var(--glass-ease) both",
          }}
          onAnimationEnd={onAnimationEnd}
        >
          {/* `--shop-mute` rather than `--shop-stone`. Stone is #9e9ea0, which
              lands near 2.4:1 on the pill — fine for a hairline, not for the
              only two things telling the shopper what this control is. Mute
              clears 4.5:1. */}
          <Search
            className="size-[1.15rem] shrink-0 text-(--shop-mute)"
            aria-hidden
          />
          <input
            type="search"
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search"
            aria-label="Search products"
            /* Mobile keyboard hints: a Search key instead of a newline, and no
               autocorrect mangling a product name into a dictionary word. */
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            /* `text-base` is load-bearing on iOS, not a style choice: Safari
               zooms the page when a focused input is under 16px. */
            className="h-14 w-full bg-transparent text-base text-(--shop-ink) placeholder:text-(--shop-mute) focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
