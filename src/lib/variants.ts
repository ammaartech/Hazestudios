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
