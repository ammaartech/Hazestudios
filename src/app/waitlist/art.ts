/**
 * The Summer Sands art, and the numbers that place it.
 *
 * Every file in `public/waitlist/` is a WebP re-encode of the campaign's
 * original PNGs — 1.5 MB of source art down to 193 KB, which matters because
 * thirty of these load at once on a page whose whole job is a first impression.
 * The wax seal alone was 354 KB; it is 11 KB here and rendered at 104px.
 *
 * Intrinsic dimensions are recorded rather than looked up so every `<img>` can
 * reserve its box. Nothing on this page is allowed to reflow as art arrives.
 */

export interface Art {
  src: string;
  width: number;
  height: number;
}

function art(name: string, width: number, height: number): Art {
  return { src: `/waitlist/${name}.webp`, width, height };
}

export const FOG_MARK = art("fog-mark", 420, 286);
export const WORDMARK = art("summer-sands", 720, 373);
export const WAX_SEAL = art("wax-seal", 311, 320);

/**
 * "hobby maxxing", cut from paper.
 *
 * `rot` is the angle each letter settles at, and `w`/`h` its intrinsic size.
 * The `gap` entry is the word break — a spacer, not an image. Rendering these
 * as pictures is what makes the lockup look hand-made, but it also means the
 * phrase is invisible to a screen reader, so the component marks every letter
 * `aria-hidden` and supplies the words once as real text.
 */
export const WORDMARK_LETTERS: (
  | { kind: "letter"; art: Art; rot: string }
  | { kind: "gap" }
)[] = [
  { kind: "letter", art: art("letter-h", 104, 129), rot: "rotate(-7deg)" },
  { kind: "letter", art: art("letter-o", 104, 134), rot: "rotate(4deg)" },
  { kind: "letter", art: art("letter-b1", 104, 131), rot: "rotate(-3deg)" },
  { kind: "letter", art: art("letter-b2", 104, 126), rot: "rotate(6deg)" },
  { kind: "letter", art: art("letter-y", 100, 137), rot: "rotate(-5deg)" },
  { kind: "gap" },
  { kind: "letter", art: art("letter-m", 130, 134), rot: "rotate(5deg)" },
  { kind: "letter", art: art("letter-a", 94, 127), rot: "rotate(-6deg)" },
  { kind: "letter", art: art("letter-x1", 110, 131), rot: "rotate(3deg)" },
  { kind: "letter", art: art("letter-x2", 114, 120), rot: "rotate(-4deg)" },
  { kind: "letter", art: art("letter-i", 98, 124), rot: "rotate(6deg)" },
  { kind: "letter", art: art("letter-n", 104, 130), rot: "rotate(-3deg)" },
  { kind: "letter", art: art("letter-g", 95, 120), rot: "rotate(5deg)" },
];

/** The phrase the letterforms spell, for anyone who cannot see them. */
export const WORDMARK_TEXT = "hobby maxxing";

const BLOOMS: Art[] = [
  art("bloom-01", 188, 178),
  art("bloom-02", 149, 171),
  art("bloom-03", 196, 260),
  art("bloom-04", 124, 136),
  art("bloom-05", 200, 182),
  art("bloom-06", 116, 114),
  art("bloom-07", 192, 211),
  art("bloom-08", 122, 121),
  art("bloom-09", 192, 186),
  art("bloom-10", 118, 146),
  art("bloom-11", 186, 192),
  art("bloom-12", 154, 178),
  art("bloom-13", 190, 183),
  art("bloom-14", 154, 188),
];

/** The bloom that sits beside the fog mark in the masthead. */
export const MASTHEAD_BLOOM = BLOOMS[0];

export interface DriftingBloom extends Art {
  /** Lane across the viewport. */
  x: string;
  /** Rendered width. */
  size: string;
  /** One full fall. */
  duration: string;
  /** Negative, so the layer starts mid-storm rather than empty. */
  delay: string;
}

/**
 * The ambient layer.
 *
 * Lanes are spread across the width and the durations are mutually prime-ish
 * (19–34s) so the fourteen never resynchronise into a visible pulse. Every
 * delay is negative: the animation is already part-way through on the first
 * frame, so a visitor arrives to flowers mid-air instead of an empty sky that
 * fills over the next twenty seconds.
 *
 * Lanes stop at 88% rather than the original's 92%: an 88px bloom starting at
 * 92% of the viewport is born half-clipped by the layer's own `overflow`.
 */
export const DRIFTING_BLOOMS: DriftingBloom[] = [
  { ...BLOOMS[0], x: "5%", size: "74px", duration: "19s", delay: "-1s" },
  { ...BLOOMS[1], x: "17%", size: "56px", duration: "24s", delay: "-6s" },
  { ...BLOOMS[2], x: "28%", size: "88px", duration: "30s", delay: "-14s" },
  { ...BLOOMS[3], x: "38%", size: "48px", duration: "21s", delay: "-9s" },
  { ...BLOOMS[4], x: "47%", size: "76px", duration: "27s", delay: "-3s" },
  { ...BLOOMS[5], x: "57%", size: "52px", duration: "23s", delay: "-17s" },
  { ...BLOOMS[6], x: "65%", size: "80px", duration: "26s", delay: "-11s" },
  { ...BLOOMS[7], x: "75%", size: "54px", duration: "32s", delay: "-21s" },
  { ...BLOOMS[8], x: "84%", size: "70px", duration: "28s", delay: "-7s" },
  { ...BLOOMS[9], x: "88%", size: "46px", duration: "20s", delay: "-24s" },
  { ...BLOOMS[10], x: "11%", size: "66px", duration: "34s", delay: "-27s" },
  { ...BLOOMS[11], x: "70%", size: "58px", duration: "25s", delay: "-30s" },
  { ...BLOOMS[12], x: "33%", size: "62px", duration: "31s", delay: "-34s" },
  { ...BLOOMS[13], x: "60%", size: "86px", duration: "29s", delay: "-38s" },
];

export interface BurstPetal extends Art {
  size: string;
  /** Where it lands, relative to the middle of the stub. */
  bx: string;
  by: string;
  duration: string;
  delay: string;
}

/** Thrown outward from the confirmation stub, once, on arrival. */
export const BURST_PETALS: BurstPetal[] = [
  { ...BLOOMS[0], size: "52px", bx: "-170px", by: "-120px", duration: "1.6s", delay: "0.18s" },
  { ...BLOOMS[1], size: "44px", bx: "180px", by: "-100px", duration: "1.8s", delay: "0.24s" },
  { ...BLOOMS[3], size: "38px", bx: "-130px", by: "150px", duration: "2s", delay: "0.3s" },
  { ...BLOOMS[4], size: "50px", bx: "150px", by: "170px", duration: "1.7s", delay: "0.36s" },
  { ...BLOOMS[6], size: "54px", bx: "10px", by: "-190px", duration: "2.1s", delay: "0.42s" },
  { ...BLOOMS[5], size: "40px", bx: "-210px", by: "30px", duration: "1.9s", delay: "0.48s" },
  { ...BLOOMS[9], size: "38px", bx: "210px", by: "60px", duration: "2s", delay: "0.54s" },
  { ...BLOOMS[7], size: "42px", bx: "-40px", by: "200px", duration: "2.2s", delay: "0.6s" },
];
