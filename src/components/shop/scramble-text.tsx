"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Lottery-tumbler text.
 *
 * Every character starts as a random glyph and the reels come to rest one at a
 * time, left to right, so a label resolves the way a slot machine settles
 * rather than fading in all at once.
 *
 * The whole effect runs on a single requestAnimationFrame loop. A timer per
 * character would be easier to write and would put six labels × a dozen
 * characters of independent timers on the main thread the moment a menu opens;
 * one loop that recomputes the whole string per tick costs the same regardless
 * of how long the word is.
 */

/** Caps and digits read as a tumbler; lowercase reads as a typo. */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** How often an unresolved character re-rolls. Faster than this is a blur. */
const ROLL_MS = 45;

/** Minimum tumble before the first reel is allowed to stop. */
const TUMBLE_MS = 130;

/** Gap between one reel stopping and the next. */
const LOCK_STEP_MS = 32;

/**
 * When a given label will have finished resolving, so a caller can schedule
 * anything that should land after it without duplicating the timing constants.
 */
export function scrambleDuration(text: string, delay = 0) {
  return delay + TUMBLE_MS + Math.max(text.length - 1, 0) * LOCK_STEP_MS;
}

/**
 * The blanket reduced-motion rule in globals.css collapses animation and
 * transition durations, but it has no reach into a rAF loop — JS motion has to
 * opt out of itself. Reading the query in an effect rather than at module scope
 * keeps the first render identical on the server and the client.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

function tumble(text: string, locked: number) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    // Whitespace is never rolled. The gaps between words are what make a phrase
    // recognisable before its letters are, and scrambling them turns the whole
    // line into noise.
    out +=
      i < locked || !character.trim()
        ? character
        : GLYPHS[(Math.random() * GLYPHS.length) | 0];
  }
  return out;
}

export function ScrambleText({
  text,
  play = true,
  delay = 0,
  className,
}: {
  text: string;
  /** Flip to true to run the effect; false renders the settled string. */
  play?: boolean;
  /** Staggers the start so a list resolves in sequence rather than at once. */
  delay?: number;
  className?: string;
}) {
  // Starting on the real string means the server and the first client render
  // agree, and a reader who never gets the animation never sees a flicker.
  const [display, setDisplay] = useState(text);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!play || reduced) {
      setDisplay(text);
      return;
    }

    let frame = 0;
    let start = 0;
    let lastRoll = 0;
    let locked = -1;

    const tick = (now: number) => {
      if (!start) {
        start = now;
        lastRoll = now;
      }
      const elapsed = now - start - delay - TUMBLE_MS;
      const settledCount =
        elapsed < 0
          ? 0
          : Math.min(Math.floor(elapsed / LOCK_STEP_MS) + 1, text.length);

      if (settledCount >= text.length) {
        setDisplay(text);
        return;
      }

      // Repaint when a reel stops, and otherwise only on the roll beat — a
      // fresh random glyph every frame is too fast to read as characters.
      const rollDue = now - lastRoll >= ROLL_MS;
      if (rollDue || settledCount !== locked) {
        if (rollDue) lastRoll = now;
        locked = settledCount;
        setDisplay(tumble(text, settledCount));
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, play, delay, reduced]);

  // Split on whitespace once so the scrambling copy can be laid out word by
  // word. Each word reserves its own box from the settled string, which means
  // the line breaks where it would have broken anyway; measuring the phrase as
  // a whole would let a wide random glyph push a wrap that the real label never
  // takes. Rubik and Work Sans are proportional, so the reservation is not
  // optional.
  const words = useMemo(() => {
    let offset = 0;
    return text
      .split(/(\s+)/)
      .filter(Boolean)
      .map((value) => {
        const start = offset;
        offset += value.length;
        return { value, start, space: !value.trim() };
      });
  }, [text]);

  // At rest there is nothing to stack, and a plain node keeps the label
  // selectable and readable to assistive tech without a duplicate copy of it.
  if (display === text) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      <span aria-hidden>
        {words.map((word, i) =>
          word.space ? (
            <span key={i} className="whitespace-pre">
              {word.value}
            </span>
          ) : (
            <span key={i} className="relative inline-block whitespace-pre">
              <span className="invisible">{word.value}</span>
              <span className="absolute inset-0">
                {display.slice(word.start, word.start + word.value.length)}
              </span>
            </span>
          )
        )}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
