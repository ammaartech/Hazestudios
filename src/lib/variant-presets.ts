/**
 * Suggested option names and values.
 *
 * Typing "Colour" and then hand-entering White, Black, Navy is the most repeated
 * keystroke sequence in the product editor. Recognising the option name and
 * offering its usual values turns that into two clicks — and, more importantly,
 * keeps the spelling consistent across products, which is what makes storefront
 * filtering by option value work at all.
 *
 * Deliberately not a client module: the presets are plain data, so a server
 * component can read them too.
 */

export interface OptionPreset {
  /** canonical spelling, used to normalise "colour"/"COLOR" → "Color" */
  name: string;
  values: string[];
  /** render values as colour swatches rather than plain chips */
  swatches?: boolean;
}

const PRESETS: OptionPreset[] = [
  {
    name: "Size",
    values: ["XS", "S", "M", "L", "XL", "XXL"],
  },
  {
    name: "Color",
    swatches: true,
    values: [
      "White",
      "Black",
      "Ivory",
      "Beige",
      "Brown",
      "Grey",
      "Navy",
      "Blue",
      "Green",
      "Red",
      "Pink",
      "Lilac",
      "Gold",
      "Silver",
    ],
  },
  {
    name: "Material",
    values: ["Cotton", "Linen", "Silk", "Satin", "Denim", "Wool", "Leather"],
  },
  {
    name: "Style",
    values: ["Regular", "Slim", "Oversized", "Cropped"],
  },
  {
    name: "Length",
    values: ["Mini", "Midi", "Maxi"],
  },
];

/** Spellings that mean the same option. */
const ALIASES: Record<string, string> = {
  colour: "Color",
  color: "Color",
  shade: "Color",
  size: "Size",
  sizes: "Size",
  fit: "Size",
  material: "Material",
  fabric: "Material",
  style: "Style",
  cut: "Style",
  length: "Length",
};

/**
 * Swatch fills. Kept to plain hex rather than theme tokens: these stand in for
 * a real-world garment colour, so they must not shift with the admin palette.
 */
const SWATCHES: Record<string, string> = {
  white: "#ffffff",
  ivory: "#fffff0",
  cream: "#fdf6e3",
  beige: "#e8dcc8",
  black: "#111111",
  grey: "#9ca3af",
  gray: "#9ca3af",
  charcoal: "#374151",
  brown: "#7c4a21",
  tan: "#d2b48c",
  navy: "#1e3a5f",
  blue: "#3b82f6",
  "aqua blue": "#7fd8d0",
  aqua: "#7fd8d0",
  teal: "#14b8a6",
  green: "#16a34a",
  olive: "#6b7d3a",
  mint: "#a7f3d0",
  yellow: "#facc15",
  mustard: "#d4a017",
  orange: "#f97316",
  peach: "#ffdab9",
  coral: "#ff7f50",
  red: "#dc2626",
  maroon: "#7f1d1d",
  burgundy: "#5c1a2b",
  pink: "#ec4899",
  blush: "#f7cad0",
  rose: "#e11d48",
  purple: "#8b5cf6",
  lilac: "#c8a2c8",
  lavender: "#d8c8ec",
  gold: "#d4af37",
  silver: "#c0c0c0",
  bronze: "#cd7f32",
};

/** The preset matching an option name, if it is one we know. */
export function presetFor(name: string): OptionPreset | null {
  const canonical = ALIASES[name.trim().toLowerCase()];
  return canonical ? (PRESETS.find((p) => p.name === canonical) ?? null) : null;
}

/** Option names offered before anything has been typed. */
export const OPTION_NAME_SUGGESTIONS = PRESETS.map((p) => p.name);

/** Hex fill for a colour value, or null when it isn't a colour we recognise. */
export function swatchFor(value: string): string | null {
  const key = value.trim().toLowerCase();
  if (SWATCHES[key]) return SWATCHES[key];
  // "Aqua Blue Shell" still reads as aqua blue: fall back to the longest
  // known colour word contained in the value, so multi-word names get a chip.
  const hit = Object.keys(SWATCHES)
    .filter((c) => key.includes(c))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? SWATCHES[hit] : null;
}

/** True when swatches should be drawn for this option's values. */
export function isColorOption(name: string): boolean {
  return presetFor(name)?.swatches === true;
}
