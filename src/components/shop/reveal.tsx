import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Scroll entrances for the storefront.
 *
 * The mechanism is deliberately split in two. The markup here is a *server*
 * component — it emits nothing but a `data-reveal` attribute and a stagger
 * index, so a page of forty product cards ships forty attributes rather than
 * forty client components. A single `<RevealObserver />` in the shop layout
 * then drives all of them from one `IntersectionObserver`.
 *
 * The hidden state lives behind `.shop[data-reveal-active]`, and only that
 * observer sets the attribute. So the failure direction is the safe one: no
 * JavaScript, a hydration error, or a reduced-motion preference all leave the
 * attribute unset and the content plainly visible. Nothing can strand a
 * section at `opacity: 0`.
 *
 * See the `Reveal` block in globals.css for the motion itself.
 */
export type RevealVariant =
  | "rise"
  | "fade"
  | "left"
  | "right"
  | "zoom"
  | "media";

/**
 * Stagger is a cascade, not a queue. Past a handful of steps the delay stops
 * reading as sequence and starts reading as the page being slow, so the index
 * saturates and the tail of a long grid arrives together.
 */
const MAX_STAGGER_INDEX = 7;

/**
 * Reveal attributes for an element that already exists.
 *
 * Preferred over wrapping wherever the markup has something to hang them on:
 * a wrapper inside a grid or a scroll rail becomes the grid item / snap
 * target, and quietly changes the layout it was only meant to animate.
 */
export function revealProps(variant: RevealVariant = "rise", index = 0) {
  return {
    "data-reveal": variant,
    style: {
      "--reveal-index": Math.min(Math.max(Math.trunc(index), 0), MAX_STAGGER_INDEX),
    } as CSSProperties,
  };
}

/** A wrapper for content with no element of its own to carry the attributes. */
export function Reveal({
  variant = "rise",
  index = 0,
  className,
  style,
  children,
}: {
  variant?: RevealVariant;
  /** Position in the cascade; multiplied by the stagger step. */
  index?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const props = revealProps(variant, index);

  return (
    <div
      {...props}
      className={className}
      style={{ ...props.style, ...style }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Scroll-reveal text                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A heading that illuminates word by word as it crosses the viewport — the
 * effect the Palo Alto storefronts lead their editorial blocks with.
 *
 * Theirs is a scroll listener that rewrites the opacity of every character on
 * every frame. This is the same effect handed to the compositor instead: each
 * word carries a `view()` timeline, so the browser ties its opacity to its own
 * progress through the scrollport and the main thread is never involved. Words
 * rather than characters because the element count is the cost here, and a word
 * is roughly a sixth of the layers for the same read.
 *
 * Gated behind `@supports` and the desktop breakpoint — see globals.css. Where
 * either fails the words are simply legible, which is why the dimmed state is
 * declared *inside* the guard and never as the default.
 */
export function ScrollRevealText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const words = text.trim().split(/\s+/);

  return (
    <span className={cn("reveal-text", className)}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`}>
          <span
            className="reveal-text__word"
            style={
              {
                "--reveal-word": i,
                "--reveal-words": words.length,
              } as CSSProperties
            }
          >
            {word}
          </span>
          {/* Outside the inline-block, so the line still breaks here. */}
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}
