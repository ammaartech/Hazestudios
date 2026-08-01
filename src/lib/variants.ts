/**
 * Variant algebra: turning a list of options into variants, and carrying
 * per-variant edits across changes to that list.
 *
 * Deliberately not a client module and free of React — this is the part of the
 * product editor most able to lose an operator's work, so it is kept pure and
 * separately testable (`scripts/verify-variant-remap.mjs`).
 */

export interface OptionDraft {
  /** stable across renames, so React keys and overrides survive editing */
  key: string;
  name: string;
  values: string[];
  /**
   * Metaobject the values came from, on options created by a CSV import. The
   * algebra below never reads it — it is carried so that editing an imported
   * product's sizes does not throw away the link its colours were drawn from.
   */
  linked_to?: string;
}

/**
 * Per-variant divergence from the product-level defaults. Only keys the operator
 * actually touched are stored — everything else falls through to the parent, so
 * changing the base price still moves untouched variants with it.
 */
export interface VariantOverride {
  price?: string;
  compare_at_price?: string;
  cost_per_item?: string;
  sku?: string;
  barcode?: string;
  weight?: string;
  available?: boolean;
  image_id?: string | null;
  /** locationId → quantity */
  inventory?: Record<string, number>;
}

export interface VariantRow {
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price: string;
  compare_at_price: string;
  cost_per_item: string;
  sku: string;
  barcode: string;
  weight: string;
  available: boolean;
  image_id: string | null;
  inventory: Record<string, number>;
  /** true when this row has its own value for the field, not the parent's */
  overridden: (keyof VariantOverride)[];
}

/** Options that actually produce variants — named, with at least one value. */
export function activeOptions(options: OptionDraft[]): OptionDraft[] {
  return options.filter((o) => o.name.trim() && o.values.length > 0);
}

/** Every combination of the filled-in options, in option order. */
export function cartesian(options: OptionDraft[]): string[][] {
  const lists = activeOptions(options).map((o) => o.values);
  if (!lists.length) return [];
  return lists.reduce<string[][]>(
    (acc, values) => acc.flatMap((combo) => values.map((v) => [...combo, v])),
    [[]]
  );
}

export function variantTitle(combo: string[]): string {
  return combo.join(" / ");
}

/**
 * A variant expressed as which value it takes for each option, keyed by the
 * option's stable `key` rather than its name or position. That is the whole
 * trick behind `remapOverrides`: renaming an option, reordering the options,
 * or inserting a new one leaves every key untouched.
 */
type Assignment = Record<string, string>;

function assignments(options: OptionDraft[]): { title: string; assign: Assignment }[] {
  const active = activeOptions(options);
  return cartesian(options).map((combo) => ({
    title: variantTitle(combo),
    assign: Object.fromEntries(active.map((o, i) => [o.key, combo[i]])),
  }));
}

/**
 * Carry per-variant edits across a change to the option structure.
 *
 * Overrides are keyed by variant title ("White / S") because that is what the
 * database keys on, but a title is derived data — reordering Colour above Size
 * rewrites every one of them. Without this, dragging an option would silently
 * discard every price, SKU and stock count the operator had entered.
 *
 * Each new variant adopts the override of the old variant that agrees with it
 * on the most options and contradicts it on none. That gives the right answer
 * for all five structural edits:
 *
 * - reorder options / rename an option → same assignments, exact match
 * - rename a value → matched through `renames`
 * - remove an option → the dropped key is ignored, so "White / S" feeds "S"
 * - add an option → "White" feeds "White / S" and "White / M" alike, which is
 *   how a colour-priced product keeps its prices when sizes are introduced
 * - remove a value → its variants are gone, and so are their overrides
 *
 * Stock is the one field that does not fan out. Prices are settings and may be
 * copied freely; a quantity is a count of physical garments, and letting one
 * shelf of 10 become four shelves of 10 would be a fiction the operator then
 * has to hunt down. On a split the count stays with the first new variant.
 */
export function remapOverrides(
  prev: Record<string, VariantOverride>,
  from: OptionDraft[],
  to: OptionDraft[],
  /** optionKey → { oldValue: newValue }, for in-place value renames */
  renames: Record<string, Record<string, string>> = {}
): Record<string, VariantOverride> {
  const old = assignments(from)
    .filter((e) => prev[e.title])
    .map((e) => ({
      override: prev[e.title],
      assign: Object.fromEntries(
        Object.entries(e.assign).map(([key, value]) => [
          key,
          renames[key]?.[value] ?? value,
        ])
      ),
    }));

  if (!old.length) return {};

  /** candidates whose stock has already been handed to a new variant */
  const stockClaimed = new Set<number>();
  const next: Record<string, VariantOverride> = {};

  for (const { title, assign } of assignments(to)) {
    let best = -1;
    let bestScore = 0;

    for (let i = 0; i < old.length; i += 1) {
      let score = 0;
      let compatible = true;
      for (const [key, value] of Object.entries(old[i].assign)) {
        if (!(key in assign)) continue; // option no longer exists — not a conflict
        if (assign[key] === value) score += 1;
        else {
          compatible = false;
          break;
        }
      }
      if (compatible && score > bestScore) {
        best = i;
        bestScore = score;
      }
    }

    if (best < 0) continue;

    const override = old[best].override;
    // A partial match means one old variant is feeding several new ones.
    const split = bestScore < Object.keys(assign).length;
    if (split && stockClaimed.has(best)) {
      const { inventory: _dropped, ...rest } = override;
      next[title] = rest;
    } else {
      next[title] = override;
      if (split) stockClaimed.add(best);
    }
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Display ordering                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Canonical garment size order. Stored lowercase and unspaced so "2XL", "2xl"
 * and "XXL" all land in the same place.
 */
const SIZE_ORDER = [
  "xxs", "2xs", "xs", "s", "m", "l", "xl",
  "xxl", "2xl", "xxxl", "3xl", "4xl",
];

function sizeRank(value: string): number {
  return SIZE_ORDER.indexOf(value.trim().toLowerCase().replace(/\s+/g, ""));
}

/**
 * Order option values for display.
 *
 * Size axes are stored in whatever order the operator typed them, which is how
 * a product ends up offering "S, M, L, XS, XL" — correct data, unreadable
 * control. Sorting happens at render time only: the stored order is left alone,
 * because it is also the variant order in the admin.
 *
 * Deliberately conservative. Anything not fully recognised — a mixed set, or a
 * non-size axis like Colour, where the operator's sequence is a real editorial
 * choice — is returned untouched.
 */
export function sortOptionValues(name: string, values: string[]): string[] {
  if (!/size/i.test(name) || values.length < 2) return values;

  if (values.every((v) => sizeRank(v) !== -1)) {
    return [...values].sort((a, b) => sizeRank(a) - sizeRank(b));
  }

  // Waist/numeric sizing: 28, 30, 32…
  if (values.every((v) => Number.isFinite(Number(v.trim())) && v.trim() !== "")) {
    return [...values].sort((a, b) => Number(a) - Number(b));
  }

  return values;
}

/* -------------------------------------------------------------------------- */
/* Display labels                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Spelled-out sizes → the codes garment labels actually use.
 *
 * Purely a rendering concern: the stored value stays whatever the operator or
 * the import typed, because it is the variant title the admin, the order record
 * and Qikink's SKUs all key on. Renaming the data to suit a chip would rewrite
 * history for a typography decision.
 *
 * Keys are normalised (lowercased, separators dropped), so "X-Large",
 * "extra large" and "XL" all arrive here as the same lookup.
 */
const SIZE_LABELS: Record<string, string> = {
  extrasmall: "XS", xsmall: "XS", xs: "XS",
  extraextrasmall: "2XS", xxsmall: "2XS", xxs: "2XS", "2xs": "2XS",
  small: "S", s: "S",
  medium: "M", med: "M", m: "M",
  large: "L", l: "L",
  extralarge: "XL", xlarge: "XL", xl: "XL",
  extraextralarge: "2XL", xxlarge: "2XL", xxl: "2XL", "2xl": "2XL", "2xlarge": "2XL",
  xxxlarge: "3XL", xxxl: "3XL", "3xl": "3XL", "3xlarge": "3XL",
  xxxxl: "4XL", "4xl": "4XL", "4xlarge": "4XL",
};

function normalizeSize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s._/-]+/g, "");
}

/**
 * The short form of a size value, for controls where the label is the whole
 * object — a size chip is read as a code, not as a sentence, and "Small /
 * Medium / Large" forces three different pill widths for one row of choices.
 *
 * Only applied to size axes, and only to values the table recognises: a colour
 * called "Large" or a bespoke value like "One Size" is returned untouched.
 */
export function shortSizeLabel(optionName: string, value: string): string {
  if (!/size/i.test(optionName)) return value;
  return SIZE_LABELS[normalizeSize(value)] ?? value;
}

/**
 * The same abbreviation applied to a variant title, for the places that show a
 * chosen combination rather than an axis — the bag, the checkout summary.
 *
 * A title has no axis names attached ("Yellow / Small"), so each segment is
 * matched against the size table on its own and anything unrecognised is left
 * exactly as stored. That keeps the bag saying the same word the product page's
 * chip said, which is the whole point: the shopper picked "S", so the bag
 * should not tell them they bought a "Small".
 */
export function shortVariantTitle(title: string): string {
  return title
    .split("/")
    .map((part) => {
      const trimmed = part.trim();
      return SIZE_LABELS[normalizeSize(trimmed)] ?? trimmed;
    })
    .join(" / ");
}
