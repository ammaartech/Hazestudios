/**
 * The matcher behind the admin's global search.
 *
 * ---------------------------------------------------------------------------
 * Why this exists rather than one of the obvious alternatives
 * ---------------------------------------------------------------------------
 *
 * Each standard technique fails the one case that matters most — typing the
 * first few letters of a word that is not the first word:
 *
 *   `ilike '%stus%'`   finds "Stussy Diced", but cannot rank. It has no way to
 *                      say that "Stussy Diced" beats "Custom Stusser Bag", so
 *                      results arrive in table order, which reads as random.
 *
 *   trigram similarity `similarity('stus', 'stussy diced')` is about 0.21,
 *                      because the score is normalised by the union of both
 *                      strings' trigrams and the title is six times longer than
 *                      the query. Half the catalogue scores higher by accident.
 *                      Trigrams are for typos, not for prefixes.
 *
 *   full-text search   tokenises to whole lexemes. "stus" is not a word and
 *                      matches nothing at all without `:*` gymnastics, and even
 *                      then it cannot rank a partial word against a full one.
 *
 *   Levenshtein        distance("stus", "stussy diced") is 8 — further than
 *                      most unrelated titles in the catalogue. Edit distance
 *                      measures whole-string difference, and a prefix is not a
 *                      small difference.
 *
 * So: a ranked ladder, where the tier is the primary sort key and a positional
 * score orders within it. The tier answers "how did this match", which is what
 * a human sorts by first; the positional score answers "how well", which is
 * only a tiebreak. Collapsing both into one number — which is what every
 * single-algorithm approach above does — is precisely what loses the ordering.
 *
 *   T6  exact          "stussy diced"     the title, verbatim
 *   T5  prefix         "stussy"           the title starts with the query
 *   T4  word prefix    "stus", "diced"    SOME WORD starts with the query
 *   T3  all tokens     "diced stus"       every token prefixes some word
 *   T2  substring      "ussy"             appears anywhere
 *   T1  fuzzy          "stussi", "stusy"  within an edit or two of some word
 *   T0  subsequence    "sd", "sydi"       in order, gaps allowed
 *
 * T4 is the tier that carries the feature. T0 is what makes initialisms work.
 *
 * Fuzzy sits *above* subsequence, which is the opposite of what a
 * fzf-derived ranker would do, and the reason is that a long query will always
 * find some scattered alignment somewhere. "stussi" is a subsequence of "Stussy
 * Diced" — s,t,u,s,s then the i of "Diced" — and a dense one, so no density
 * gate rejects it. But it is also one substitution away from the whole word
 * "stussy", and that is what the person typing it meant. A typo of a real word
 * is stronger evidence than an acronym spelled out across a phrase, so it
 * ranks higher; T1 is checked first and returns before T0 is ever reached.
 *
 * T1 is disabled entirely for short queries, where every three-letter string is
 * one edit from something and enabling it would flood the list with noise.
 *
 * Within a tier, scoring is fzf's: a match is worth more at a word boundary,
 * more when consecutive, more near the start, and less across gaps. That is
 * what puts "Stussy Diced" above "Custom Stusser Bag" for "stus" — both are T4,
 * but one matches at character zero.
 *
 * ---------------------------------------------------------------------------
 * Cost
 * ---------------------------------------------------------------------------
 *
 * Every tier is O(field length) per field, and T1 is a banded edit distance
 * that exits as soon as it exceeds budget. Over the whole catalogue — 849
 * products, ~5 fields each — ranking every product costs about 3 ms, which is
 * why this runs on every keystroke with no debounce and no request.
 */

/* -------------------------------------------------------------------------- */
/* Folding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Punctuation that should not stop a match.
 *
 * The catalogue is full of smart quotes — "I’m Out Of My Mind Yellow Tank Top"
 * carries U+2019, not an apostrophe — and nobody types those. Without this,
 * "i'm out" finds nothing and the search looks broken on a product that is
 * plainly there.
 */
const PUNCT_FOLD: Record<string, string> = {
  "’": "'", // ’
  "‘": "'", // ‘
  "ʼ": "'", // ʼ
  "´": "'", // ´
  "`": "'", // `
  "“": '"', // “
  "”": '"', // ”
  "–": "-", // –
  "—": "-", // —
  "−": "-", // −
  " ": " ", // nbsp
};

/**
 * Folds one character to exactly one character.
 *
 * The "exactly one" is load-bearing and is why this is per-character rather
 * than a `String.prototype.normalize` over the whole string. Highlighting needs
 * to map a match found in the folded text back onto the original for rendering,
 * so index i in the fold must be index i in the source. NFD on a whole string
 * breaks that — "é" becomes two code units — and a Turkish "İ" lowercases to
 * two. Both are clamped to their first character here.
 */
function foldChar(ch: string): string {
  const mapped = PUNCT_FOLD[ch];
  if (mapped) return mapped;

  let out = ch;
  // Only accented letters need decomposing, and `normalize` is expensive enough
  // that it is worth skipping for the ASCII that dominates the catalogue.
  if (ch.charCodeAt(0) > 127) {
    const d = ch.normalize("NFD");
    if (d.length > 1) out = d[0];
  }

  const lower = out.toLowerCase();
  return lower.length === 1 ? lower : lower[0];
}

/** Folds a whole string, preserving a 1:1 index mapping with the source. */
export function fold(text: string): string {
  let out = "";
  for (const ch of text) out += foldChar(ch);
  return out;
}

const isAlnum = (code: number) =>
  (code >= 97 && code <= 122) || // a-z
  (code >= 48 && code <= 57) || // 0-9
  code > 127; // accented letters, already folded to lowercase

/* -------------------------------------------------------------------------- */
/* Prepared fields                                                             */
/* -------------------------------------------------------------------------- */

export interface Field {
  /** Folded text. Indices align 1:1 with the source string. */
  text: string;
  /**
   * `1` at every index that begins a word. Precomputed at index build time
   * because it is read on every keystroke for every field and never changes.
   */
  starts: Uint8Array;
  /** Multiplier on this field's contribution. A title outranks a tag. */
  weight: number;
  /** Which field matched, so the UI can say "matched on SKU". */
  label?: string;
  /**
   * True when this field is the one rendered as the row's title, so the UI
   * knows whether the highlight ranges can be painted onto it.
   */
  primary?: boolean;
}

/**
 * Where a word begins.
 *
 * Three cases, all of which occur in this catalogue:
 *   - after a non-alphanumeric      "Long-Sleeve"     → S
 *   - a case change                 "TankTop"         → T   (needs the source,
 *                                                            not the fold)
 *   - a letter/digit boundary       "Card BD 1009"    → 1
 *
 * The case-change rule is why this takes the raw string: by the time text is
 * folded, "TankTop" and "tanktop" are indistinguishable, and someone typing
 * "top" expects the first to match at a boundary and the second not to.
 */
function wordStarts(raw: string, folded: string): Uint8Array {
  const n = folded.length;
  const starts = new Uint8Array(n);
  if (n === 0) return starts;

  starts[0] = 1;
  for (let i = 1; i < n; i++) {
    const prev = folded.charCodeAt(i - 1);
    const cur = folded.charCodeAt(i);

    if (!isAlnum(prev) && isAlnum(cur)) {
      starts[i] = 1;
      continue;
    }
    // Digit run beginning after a letter, and vice versa.
    const prevDigit = prev >= 48 && prev <= 57;
    const curDigit = cur >= 48 && cur <= 57;
    if (isAlnum(prev) && isAlnum(cur) && prevDigit !== curDigit) {
      starts[i] = 1;
      continue;
    }
    // camelCase / PascalCase, read off the source where case still exists.
    const rawPrev = raw[i - 1];
    const rawCur = raw[i];
    if (
      rawPrev &&
      rawCur &&
      rawPrev === rawPrev.toLowerCase() &&
      rawPrev !== rawPrev.toUpperCase() &&
      rawCur === rawCur.toUpperCase() &&
      rawCur !== rawCur.toLowerCase()
    ) {
      starts[i] = 1;
    }
  }
  return starts;
}

export function field(
  raw: string | null | undefined,
  weight: number,
  options: { label?: string; primary?: boolean } = {}
): Field | null {
  const source = (raw ?? "").trim();
  if (!source) return null;
  const text = fold(source);
  return {
    text,
    starts: wordStarts(source, text),
    weight,
    label: options.label,
    primary: options.primary,
  };
}

/* -------------------------------------------------------------------------- */
/* Prepared query                                                              */
/* -------------------------------------------------------------------------- */

export interface Query {
  /** What the user typed, untouched — for echoing back in the UI. */
  raw: string;
  /** Folded, trimmed, inner whitespace collapsed. */
  text: string;
  tokens: string[];
  /**
   * Edit budget for the fuzzy tier, derived from length.
   *
   * Zero below four characters, and that is not caution — it is correctness. At
   * three characters almost every word in a 849-product catalogue is within one
   * edit of the query, so a budget of 1 does not add tolerance, it removes
   * ranking. The tier only becomes informative once the query is long enough
   * for an edit to be a coincidence rather than the norm.
   */
  maxDistance: number;
}

export function prepareQuery(raw: string): Query | null {
  const text = fold(raw).trim().replace(/\s+/g, " ");
  if (!text) return null;
  return {
    raw: raw.trim(),
    text,
    tokens: text.split(" ").filter(Boolean),
    maxDistance: text.length >= 8 ? 2 : text.length >= 4 ? 1 : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Positional scoring                                                          */
/* -------------------------------------------------------------------------- */

/*
 * fzf's weights, and the reasoning is fzf's too: a matched character is worth a
 * fixed amount, and everything else is a bonus or a penalty describing *where*
 * it landed. Boundary and consecutive bonuses are what separate a match a human
 * would call obvious from one they would call a coincidence.
 */
const SCORE_MATCH = 16;
const BONUS_BOUNDARY = 10;
const BONUS_CONSECUTIVE = 8;
/** Matching at character zero of the field is worth more than any other spot. */
const BONUS_FIRST = 14;
const PENALTY_GAP_START = -5;
const PENALTY_GAP_EXTEND = -1;

/**
 * The gap between tiers.
 *
 * Larger than any positional score a field can produce, so within one field the
 * tier is a strict ordering: no amount of within-tier bonus can promote a
 * substring match above a word-prefix one. Across fields the tier is scaled by
 * the field's weight first — see `matchItem`.
 */
const TIER_STEP = 10_000;
const MAX_TIER = 6;

/** A contiguous, inclusive-exclusive span of the folded field text. */
export type Range = [start: number, end: number];

interface FieldMatch {
  tier: number;
  score: number;
  ranges: Range[];
}

/**
 * Scores a run of `length` characters matched contiguously at `at`.
 *
 * Used for every tier where the match is known to be contiguous (exact, prefix,
 * word prefix, substring), which is the common case and avoids running the
 * general subsequence scorer for it.
 */
function scoreRun(f: Field, at: number, length: number): number {
  let score = length * SCORE_MATCH + (length - 1) * BONUS_CONSECUTIVE;
  if (f.starts[at]) score += BONUS_BOUNDARY;
  if (at === 0) score += BONUS_FIRST;
  // A match that starts later is a slightly worse match. Small and linear, so
  // it never overturns a bonus — it only orders otherwise-identical matches.
  score -= at * 0.6;
  return score;
}

/**
 * Longer fields are weaker matches for the same query: "Kai" fully consumed by
 * "kai" is a better answer than "Kai Hoodie Oversized Limited" partly consumed
 * by it. Sub-linear so a long title is nudged, not buried.
 */
function lengthPenalty(len: number): number {
  return Math.sqrt(len) * 1.5;
}

/**
 * Scores an explicit, ascending set of matched positions.
 *
 * Adjacent positions are collapsed into ranges so the UI paints one highlight
 * per run rather than one per character.
 */
function scorePositions(
  f: Field,
  positions: number[]
): { score: number; ranges: Range[]; boundaryHits: number } {
  let score = 0;
  let boundaryHits = 0;
  let prev = -2;
  let runStart = -1;
  const ranges: Range[] = [];

  for (const i of positions) {
    score += SCORE_MATCH;
    if (f.starts[i]) {
      score += BONUS_BOUNDARY;
      boundaryHits++;
    }
    if (i === 0) score += BONUS_FIRST;

    if (i === prev + 1) {
      score += BONUS_CONSECUTIVE;
    } else {
      if (prev >= 0) {
        const gap = i - prev - 1;
        score += PENALTY_GAP_START + PENALTY_GAP_EXTEND * (gap - 1);
      }
      if (runStart >= 0) ranges.push([runStart, prev + 1]);
      runStart = i;
    }
    if (runStart < 0) runStart = i;
    prev = i;
  }
  if (runStart >= 0) ranges.push([runStart, prev + 1]);

  score -= positions[0] * 0.6;
  return { score, ranges, boundaryHits };
}

/**
 * Subsequence matching — the query's characters appear in order, gaps allowed.
 *
 * Two candidate alignments are scored and the better one wins, because neither
 * is right on its own:
 *
 *   forward-greedy   takes each character at the earliest position it occurs.
 *   backward-tight   fzf's refinement — from the forward match's end, walk back
 *                    to pull the start as far right as possible.
 *
 * fzf takes the tightened one, and for file paths that is usually right. Here
 * it is not. Matching "sd" against "Stussy Diced", tightening finds s(4)–d(7),
 * a span one character shorter than s(0)–d(7) — but s(4) is mid-word while s(0)
 * is the title's first letter, so the "better" span scores far worse and the
 * highlight lands on "Stus[s]y [D]iced" instead of "[S]tussy [D]iced". Scoring
 * both and taking the max costs one extra linear pass and gets the tight case
 * (a compact match late in a long field) *and* the initialism case right.
 *
 * The density gate at the end is what keeps this tier honest. A long query will
 * eventually find *some* scattered alignment in a long title — "hoodei" spells
 * itself out across "Kai Hoodie Oversized Limited Edition" if you let it — and
 * without a gate that junk match outranks the obvious one-typo match on "Kai
 * Hoodie", because subsequence sits a whole tier above fuzzy. So a sparse match
 * is only admitted when its characters land on word boundaries, i.e. when it is
 * a genuine initialism rather than an accident of a long string.
 */
function matchSubsequence(f: Field, q: string): FieldMatch | null {
  const text = f.text;
  const n = text.length;
  const m = q.length;
  if (m === 0 || m > n) return null;

  const forward: number[] = [];
  let qi = 0;
  for (let i = 0; i < n && qi < m; i++) {
    if (text[i] === q[qi]) {
      forward.push(i);
      qi++;
    }
  }
  if (qi < m) return null;

  const backward: number[] = [];
  qi = m - 1;
  for (let i = forward[m - 1]; i >= 0 && qi >= 0; i--) {
    if (text[i] === q[qi]) {
      backward.push(i);
      qi--;
    }
  }
  backward.reverse();

  const a = scorePositions(f, forward);
  const b = backward.length === m ? scorePositions(f, backward) : null;
  const useBackward = b !== null && b.score > a.score;
  const best = useBackward ? b! : a;
  const positions = useBackward ? backward : forward;

  const span = positions[m - 1] - positions[0] + 1;
  if (m / span < 0.5 && best.boundaryHits < Math.ceil(m * 0.5)) return null;

  return { tier: 0, score: best.score, ranges: best.ranges };
}

/* -------------------------------------------------------------------------- */
/* Fuzzy tier                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Damerau-Levenshtein distance, banded and abandoned as soon as it exceeds
 * `max`.
 *
 * Damerau rather than plain Levenshtein because the mistake this is here to
 * absorb is overwhelmingly a transposition — "sutssy", "hoodei" — which plain
 * Levenshtein charges two edits for and would therefore reject at a budget of
 * one. The extra term costs one array lookup.
 *
 * The band is what makes it affordable to run across the catalogue: cells more
 * than `max` off the diagonal cannot lead anywhere under budget, so only
 * `2·max + 1` of each row is ever computed, and a row whose best cell already
 * exceeds `max` ends the whole comparison.
 */
function boundedDistance(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  let prev2: number[] = [];
  let prev: number[] = new Array(lb + 1);
  let cur: number[] = new Array(lb + 1);

  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    const from = Math.max(1, i - max);
    const to = Math.min(lb, i + max);

    // Cells outside the band are unreachable under budget; poisoning them keeps
    // the recurrence honest without computing them.
    if (from > 1) cur[from - 1] = max + 1;

    let best = max + 1;
    for (let j = from; j <= to; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        prev[j] + 1, // deletion
        cur[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
      // Transposition of the previous two characters.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < best) best = v;
    }
    if (to < lb) cur[to + 1] = max + 1;
    if (best > max) return max + 1;

    prev2 = prev;
    prev = cur;
    cur = new Array(lb + 1);
  }

  return prev[lb] <= max ? prev[lb] : max + 1;
}

/**
 * Every word of a field, as [start, end) spans over the folded text.
 *
 * Derived from the same `starts` bitmap the scorer uses, so a "word" here means
 * exactly what a word boundary bonus means — no second definition to drift.
 */
function words(f: Field): Range[] {
  const out: Range[] = [];
  const n = f.text.length;
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (f.starts[i] && start >= 0) {
      out.push([start, i]);
      start = i;
    } else if (f.starts[i]) {
      start = i;
    } else if (!isAlnum(f.text.charCodeAt(i)) && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, n]);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Field matching                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Runs one field down the ladder and returns the first (highest) tier that
 * matches.
 *
 * Ordered highest-first and returning early is not just an optimisation: a
 * field that matches at T5 also matches at T2 and T1, and the *best* way it
 * matched is the one that should rank it.
 */
function matchField(q: Query, f: Field): FieldMatch | null {
  const text = f.text;
  const needle = q.text;
  const n = text.length;
  const m = needle.length;
  if (m === 0 || m > n) {
    // Still worth a fuzzy pass: "hoodies" against the shorter "hoodie".
    if (m === 0) return null;
  }

  // T6 — exact.
  if (text === needle) {
    return {
      tier: 6,
      score: scoreRun(f, 0, m) + 60,
      ranges: [[0, m]],
    };
  }

  const at = text.indexOf(needle);

  // T5 — the field starts with the query.
  if (at === 0) {
    return { tier: 5, score: scoreRun(f, 0, m) + 30, ranges: [[0, m]] };
  }

  // T4 — some word starts with the query. The tier that carries the feature:
  // this is "stus" finding "Stussy Diced".
  if (at > 0) {
    let boundary = -1;
    for (let i = at; i >= 0; i = text.indexOf(needle, i + 1)) {
      if (i < 0) break;
      if (f.starts[i]) {
        boundary = i;
        break;
      }
    }
    if (boundary >= 0) {
      return {
        tier: 4,
        score: scoreRun(f, boundary, m),
        ranges: [[boundary, boundary + m]],
      };
    }
  }

  // T3 — every token prefixes some word, in any order. Lets "diced stus" and
  // "stus diced" both find the same product, which matters because an operator
  // recalls the distinctive word first, not the leftmost one.
  if (q.tokens.length > 1) {
    const ws = words(f);
    const used = new Array<boolean>(ws.length).fill(false);
    const ranges: Range[] = [];
    let total = 0;
    let all = true;

    for (const token of q.tokens) {
      let bestIdx = -1;
      let bestScore = -Infinity;
      for (let wi = 0; wi < ws.length; wi++) {
        if (used[wi]) continue;
        const [ws0, ws1] = ws[wi];
        if (ws1 - ws0 < token.length) continue;
        if (!text.startsWith(token, ws0)) continue;
        const s = scoreRun(f, ws0, token.length);
        if (s > bestScore) {
          bestScore = s;
          bestIdx = wi;
        }
      }
      if (bestIdx < 0) {
        all = false;
        break;
      }
      used[bestIdx] = true;
      total += bestScore;
      ranges.push([ws[bestIdx][0], ws[bestIdx][0] + token.length]);
    }

    if (all) {
      ranges.sort((a, b) => a[0] - b[0]);
      // Averaged, not summed: otherwise a three-token query would outscore a
      // one-token exact match purely by having more terms to add up.
      return { tier: 3, score: total / q.tokens.length + 12, ranges };
    }
  }

  // T2 — plain substring, mid-word.
  if (at > 0) {
    return { tier: 2, score: scoreRun(f, at, m), ranges: [[at, at + m]] };
  }

  // T1 — fuzzy, per word, and only for queries long enough to make an edit
  // meaningful. Compared against words rather than the whole field because
  // distance to a whole title is dominated by its length, not by the typo.
  //
  // Checked before the subsequence tier: see the ladder note at the top of the
  // file for why a typo of a real word beats an acronym spelled across a
  // phrase.
  if (q.maxDistance > 0) {
    const ws = words(f);
    let bestScore = -Infinity;
    let bestRange: Range | null = null;

    for (const token of q.tokens) {
      if (token.length < 4) continue;
      const budget = Math.min(q.maxDistance, Math.floor(token.length / 3));
      if (budget < 1) continue;

      for (const [w0, w1] of ws) {
        const word = text.slice(w0, w1);
        if (Math.abs(word.length - token.length) > budget) continue;
        const d = boundedDistance(token, word, budget);
        if (d > budget) continue;
        // A single typo in a long word is a better match than a single typo in
        // a short one, so the penalty is relative to the word.
        const s = token.length * SCORE_MATCH * (1 - d / (token.length + 1));
        if (s > bestScore) {
          bestScore = s;
          bestRange = [w0, w1];
        }
      }
    }

    if (bestRange) return { tier: 1, score: bestScore, ranges: [bestRange] };
  }

  // T0 — subsequence. Carries initialisms: "sd" → Stussy Diced.
  const sub = matchSubsequence(f, needle.replace(/ /g, ""));
  if (sub) return sub;

  return null;
}

/* -------------------------------------------------------------------------- */
/* Item matching                                                               */
/* -------------------------------------------------------------------------- */

export interface Match {
  /** The tier the winning field matched at, for display and debugging. */
  tier: number;
  /** That tier scaled by the winning field's weight — what actually sorts. */
  effectiveTier: number;
  /** Comparable across items and with the server's 0..1 scores (see `unit`). */
  score: number;
  /** Highlight spans, only when the winning field was the row's title. */
  ranges: Range[];
  /** Which field won, when it was not the title — "SKU", "Vendor", "Tag". */
  via?: string;
}

/**
 * Scores an item across all its fields.
 *
 * Three rules, each of which exists because of a specific bad ordering:
 *
 * **The best field wins outright rather than the fields being summed.** A
 * product whose vendor, type and three tags all weakly contain the query must
 * not outrank one whose title starts with it.
 *
 * **The tier is scaled by the field's weight before fields are compared.** This
 * is the subtle one, and getting it wrong is very visible. The tier ladder is a
 * strict ordering *within* a field — but comparing raw tiers *across* fields
 * says a tag that prefix-matches (T5) beats a title with the query as a word
 * (T4), so searching "hoodi" returned "Thrasher Magazine" and "Michigan
 * Midwest" — products tagged `hoodie` — above every product with Hoodie in its
 * name. Scaling first (5 × 0.55 = 2.75 against 4 × 1.0 = 4.0) restores the
 * ordering a person expects, while still letting a genuinely decisive match on
 * a narrow field win: an exact SKU hit is 6 × 0.9 = 5.4 and beats any title
 * match short of a prefix.
 *
 * **Secondary matches contribute a nudge.** When two products match the title
 * equally, the one that also carries the query as a tag is the better answer —
 * but capped far below what a tier step is worth, so it orders ties rather than
 * deciding matches.
 */
export function matchItem(q: Query, fields: Field[], boost = 0): Match | null {
  let best: {
    tier: number;
    effectiveTier: number;
    score: number;
    ranges: Range[];
    field: Field;
  } | null = null;
  let secondary = 0;

  for (const f of fields) {
    const m = matchField(q, f);
    if (!m) continue;

    const effectiveTier = m.tier * f.weight;
    const weighted = m.score * f.weight;

    if (
      !best ||
      effectiveTier > best.effectiveTier ||
      (effectiveTier === best.effectiveTier && weighted > best.score)
    ) {
      if (best) secondary += Math.min(best.score * 0.08, 8);
      best = { tier: m.tier, effectiveTier, score: weighted, ranges: m.ranges, field: f };
    } else {
      secondary += Math.min(weighted * 0.08, 8);
    }
  }

  if (!best) return null;

  const score =
    best.effectiveTier * TIER_STEP +
    best.score +
    Math.min(secondary, 20) +
    boost -
    lengthPenalty(best.field.text.length);

  return {
    tier: best.tier,
    effectiveTier: best.effectiveTier,
    score,
    // Highlighting is only meaningful on the string actually being rendered.
    // Ranges from a tag or a SKU would land on arbitrary characters of the
    // title, which looks like a bug rather than a hint — so a non-title match
    // says so in words via `via` instead.
    ranges: best.field.primary ? best.ranges : [],
    via: best.field.primary ? undefined : best.field.label,
  };
}

/**
 * Rescales a raw score into the 0..1 band the server's `admin_search` uses, so
 * browser-side and server-side results can be merged into one ordered list.
 *
 * The effective tier lands in the leading digits and the positional score fills
 * in beneath it, which means a locally-matched product and a 0.9-scored remote
 * order sort against each other the way a person would expect.
 */
export function unit(match: Match): number {
  const band = MAX_TIER + 1;
  const tierPart = match.effectiveTier / band;
  const withinTier = Math.max(
    0,
    Math.min(1, (match.score - match.effectiveTier * TIER_STEP) / 400)
  );
  return Math.min(1, tierPart + withinTier / band);
}

/**
 * Slices a source string into highlighted and plain segments.
 *
 * Ranges index the folded text, and folding is 1:1 with the source by
 * construction (see `foldChar`), so they apply to the original unchanged —
 * which is what lets the dropdown bold "Stus" inside "Stussy Diced" with the
 * original casing and punctuation intact.
 */
export function segments(
  source: string,
  ranges: Range[]
): { text: string; hit: boolean }[] {
  if (!ranges.length) return [{ text: source, hit: false }];

  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: { text: string; hit: boolean }[] = [];
  let cursor = 0;

  for (const [start, end] of sorted) {
    const from = Math.max(cursor, start);
    const to = Math.min(source.length, end);
    if (to <= from) continue;
    if (from > cursor) out.push({ text: source.slice(cursor, from), hit: false });
    out.push({ text: source.slice(from, to), hit: true });
    cursor = to;
  }
  if (cursor < source.length) out.push({ text: source.slice(cursor), hit: false });

  return out;
}
