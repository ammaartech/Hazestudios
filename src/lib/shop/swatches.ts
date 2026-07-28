import type { ShopProduct, ShopVariant } from "./queries";

/**
 * Colour swatches for the product carousels.
 *
 * A swatch needs two things the catalogue does not store directly: a colour to
 * paint the chip, and the photograph to show when it is picked. Both are derived
 * — the chip from the option value's name, the photograph from the variant's
 * linked image. Nothing here needs a new column.
 */

/**
 * Names that CSS does not know, or knows differently to a garment dyer. Anything
 * absent falls through to the CSS colour of the same name, so `Coral`,
 * `Lavender` and `Maroon` need no entry.
 */
const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#fafafa",
  "off white": "#f2efe6",
  bone: "#e3ddd1",
  ecru: "#d6cdb8",
  cream: "#f4ecdc",
  charcoal: "#36393d",
  slate: "#5a6673",
  stone: "#a49c92",
  sand: "#d8c7a9",
  taupe: "#b0a08d",
  khaki: "#bda878",
  olive: "#6b6b3a",
  "olive green": "#6b6b3a",
  "bottle green": "#0b4a34",
  "petrol blue": "#1f5f6b",
  "navy blue": "#16233f",
  navy: "#16233f",
  "royal blue": "#4169e1",
  "light blue": "#add8e6",
  "baby blue": "#bcd8ef",
  "grey melange": "#a8a8a4",
  "gray melange": "#a8a8a4",
  melange: "#a8a8a4",
  "muted purple": "#8d7391",
  lilac: "#c8a8d8",
  mauve: "#b184a5",
  rust: "#a5462a",
  brick: "#963c2e",
  mustard: "#d3a02a",
  "washed black": "#2f2f2f",
  "acid wash": "#9fb3c8",
  multi: "#8c8c8c",
};

/** Web colours the browser will resolve from the name alone. */
const CSS_NAMED = new Set([
  "red", "blue", "green", "yellow", "orange", "purple", "pink", "brown",
  "grey", "gray", "beige", "coral", "lavender", "maroon", "teal", "tan",
  "gold", "silver", "ivory", "salmon", "plum", "indigo", "violet", "aqua",
  "turquoise", "crimson", "magenta", "cyan", "lime", "olive", "navy",
]);

/**
 * The paint for one chip. Unknown names get a neutral rather than a guess — a
 * wrong colour is worse than an obviously-absent one, and the value's name is
 * always available to screen readers and the tooltip regardless.
 */
export function swatchColor(value: string): string {
  const key = value.trim().toLowerCase();
  if (NAMED[key]) return NAMED[key];
  if (CSS_NAMED.has(key)) return key;
  // "Washed Indigo" → try the last word, which is usually the hue.
  const last = key.split(/\s+/).at(-1) ?? "";
  if (NAMED[last]) return NAMED[last];
  if (CSS_NAMED.has(last)) return last;
  return "#c9c7c2";
}

/** True for colours light enough that the chip needs a visible outline. */
export function isPaleSwatch(color: string): boolean {
  const hex = color.startsWith("#") ? color : "";
  if (!hex) return ["white", "ivory", "beige", "lavender", "tan"].includes(color);
  const n = hex.length === 4
    ? hex.slice(1).split("").map((c) => parseInt(c + c, 16))
    : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // Rec. 709 luma; 0.82 is where a chip stops separating from the white card.
  return (0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]) / 255 > 0.82;
}

export interface Swatch {
  value: string;
  color: string;
  pale: boolean;
  /** The variant photograph, so hovering a chip previews that colourway. */
  image: string | null;
}

/** Which option index (`option1`…`option3`) a named option occupies. */
function optionSlot(product: ShopProduct, name: string): 1 | 2 | 3 | null {
  const i = product.options.findIndex((o) => o.name === name);
  return i === 0 ? 1 : i === 1 ? 2 : i === 2 ? 3 : null;
}

/**
 * The colour option, under either spelling. Returns an empty list for products
 * that aren't merchandised by colour, which is the signal to render no chips at
 * all rather than a row of one.
 */
export function colorSwatches(product: ShopProduct): Swatch[] {
  const option = product.options.find((o) => /^colou?r$/i.test(o.name));
  if (!option || option.values.length < 2) return [];

  const slot = optionSlot(product, option.name);
  const imageById = new Map(product.images.map((img) => [img.id, img.url]));

  return option.values.map((value) => {
    const variant = product.variants.find(
      (v: ShopVariant) =>
        (slot === 1 ? v.option1 : slot === 2 ? v.option2 : v.option3) === value
    );
    const color = swatchColor(value);
    return {
      value,
      color,
      pale: isPaleSwatch(color),
      image: (variant?.image_id && imageById.get(variant.image_id)) || null,
    };
  });
}

/**
 * The two spec chips under the title — Shopify carries these as metafields; here
 * the closest honest source is the product's own tags. Two is the cap: the row
 * sits on one line at the narrowest card width.
 */
export function specLabels(product: ShopProduct): string[] {
  return product.tags.slice(0, 2).map((t) => t.toUpperCase());
}

/**
 * The corner badge. Order is deliberate — an out-of-stock card must never also
 * claim to be selling fast, and a markdown outranks a scarcity nudge because it
 * is a fact about the price rather than an inference about demand.
 */
function productBadge(product: ShopProduct): string | null {
  if (!product.inStock) return "Sold Out";
  if (product.compare_at_price && product.compare_at_price > product.price) {
    const off = Math.round(
      ((product.compare_at_price - product.price) / product.compare_at_price) * 100
    );
    return off > 0 ? `Save ${off}%` : null;
  }
  // Only meaningful when inventory is actually counted for this product.
  if (product.track_inventory && product.totalStock > 0 && product.totalStock <= 5) {
    return "Selling Fast";
  }
  return null;
}

/* -------------------------------------------------------------------------- */

/**
 * What a carousel card actually needs.
 *
 * The carousels are client components — they hold swatch and scroll state — so
 * everything they render crosses the server/client boundary and lands in the
 * HTML payload. A full `ShopProduct` carries every variant, every image and
 * every inventory field; a rail of twelve would serialise a few hundred
 * kilobytes of it that nothing on screen reads. This is the projection down to
 * the fields the card paints.
 */
export interface RailProduct {
  id: string;
  handle: string;
  title: string;
  price: number;
  compareAt: number | null;
  badge: string | null;
  labels: string[];
  swatches: Swatch[];
  /** Primary shot, plus the one that cross-fades in on hover. */
  image: string | null;
  hoverImage: string | null;
  alt: string;
  inStock: boolean;
}

export function toRailProduct(product: ShopProduct): RailProduct {
  const [primary, secondary] = product.images;

  return {
    id: product.id,
    handle: product.handle || product.id,
    title: product.title,
    price: product.price,
    compareAt: product.compare_at_price,
    badge: productBadge(product),
    labels: specLabels(product),
    swatches: colorSwatches(product),
    image: primary?.url ?? null,
    hoverImage: secondary?.url ?? null,
    alt: primary?.alt || product.title,
    inStock: product.inStock,
  };
}
