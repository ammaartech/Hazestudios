/**
 * Size chart vocabulary and garment presets.
 *
 * The problem this shape solves: a t-shirt and a dress do not share a
 * measurement set, so a fixed column list would force operators to leave half
 * the grid blank on every product. Instead each product picks the measurements
 * that apply, and the grid is built from that selection.
 *
 * Everything is entered and stored in INCHES, as strings, exactly as typed —
 * "26-28" and "38.5" are both legitimate entries that a numeric column could
 * not hold. Conversion to cm happens at display time on the storefront.
 *
 * Plain data, no "use client": the storefront renders the chart on the server.
 */

export interface Measurement {
  /** Stable key stored in the chart JSON — never renamed. */
  key: string;
  label: string;
  /** Shown under the storefront table so a shopper measures the same way. */
  help: string;
}

/**
 * The full vocabulary. A product uses a subset; nothing here is mandatory.
 * Keys are stable identifiers, so relabelling one later does not orphan data.
 */
export const MEASUREMENTS: Measurement[] = [
  { key: "chest", label: "Chest", help: "Measured flat across the chest, one inch below the armhole, then doubled." },
  { key: "bust", label: "Bust", help: "Around the fullest part of the bust, keeping the tape level." },
  { key: "underbust", label: "Underbust", help: "Directly under the bust, where a band would sit." },
  { key: "waist", label: "Waist", help: "Around the narrowest part of the natural waist." },
  { key: "hip", label: "Hip", help: "Around the fullest part of the hip, roughly eight inches below the waist." },
  { key: "shoulder", label: "Shoulder", help: "Seam to seam across the back of the shoulders." },
  { key: "sleeve", label: "Sleeve length", help: "From the shoulder seam to the sleeve opening." },
  { key: "bicep", label: "Bicep", help: "Around the widest part of the upper arm." },
  { key: "neck", label: "Neck", help: "Around the base of the neck." },
  { key: "length", label: "Length", help: "From the highest point of the shoulder straight down to the hem." },
  { key: "inseam", label: "Inseam", help: "From the crotch seam down the inside leg to the hem." },
  { key: "outseam", label: "Outseam", help: "From the top of the waistband down the outside leg to the hem." },
  { key: "rise", label: "Rise", help: "From the crotch seam up to the top of the waistband, at the front." },
  { key: "thigh", label: "Thigh", help: "Around the widest part of the thigh." },
  { key: "legOpening", label: "Leg opening", help: "Across the hem of the leg, then doubled." },
  { key: "hem", label: "Hem", help: "Across the bottom opening of the garment, then doubled." },
];

const BY_KEY = new Map(MEASUREMENTS.map((m) => [m.key, m]));

export function measurement(key: string): Measurement | undefined {
  return BY_KEY.get(key);
}

export function measurementLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

export interface GarmentPreset {
  id: string;
  label: string;
  /** Matched against product_type/category to suggest a preset automatically. */
  matches: string[];
  measurements: string[];
  sizes: string[];
}

const APPAREL_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const WAIST_SIZES = ["28", "30", "32", "34", "36", "38"];

export const GARMENT_PRESETS: GarmentPreset[] = [
  {
    id: "tshirt",
    label: "T-shirt / Top",
    matches: ["t-shirt", "tshirt", "tee", "top", "shirt", "blouse", "vest", "tank"],
    measurements: ["chest", "length", "shoulder", "sleeve"],
    sizes: APPAREL_SIZES,
  },
  {
    id: "dress",
    label: "Dress",
    matches: ["dress", "gown", "jumpsuit", "romper"],
    measurements: ["bust", "waist", "hip", "length", "shoulder"],
    sizes: APPAREL_SIZES,
  },
  {
    id: "bottoms",
    label: "Trousers / Jeans",
    matches: ["trouser", "pant", "jean", "chino", "short", "legging"],
    measurements: ["waist", "hip", "inseam", "rise", "thigh", "legOpening"],
    sizes: WAIST_SIZES,
  },
  {
    id: "skirt",
    label: "Skirt",
    matches: ["skirt"],
    measurements: ["waist", "hip", "length", "hem"],
    sizes: APPAREL_SIZES,
  },
  {
    id: "outerwear",
    label: "Jacket / Outerwear",
    matches: ["jacket", "coat", "blazer", "hoodie", "sweatshirt", "sweater", "knit", "cardigan"],
    measurements: ["chest", "length", "shoulder", "sleeve", "hem"],
    sizes: APPAREL_SIZES,
  },
  {
    id: "custom",
    label: "Custom",
    matches: [],
    measurements: [],
    sizes: APPAREL_SIZES,
  },
];

export function preset(id: string): GarmentPreset | undefined {
  return GARMENT_PRESETS.find((p) => p.id === id);
}

/**
 * Best-guess preset from the product's own type/category text, so an operator
 * adding a "Dress" usually finds the right columns already selected.
 */
export function suggestPreset(...hints: string[]): GarmentPreset {
  const haystack = hints.join(" ").toLowerCase();
  for (const p of GARMENT_PRESETS) {
    if (p.matches.some((token) => haystack.includes(token))) return p;
  }
  return GARMENT_PRESETS[0];
}

/* -------------------------------------------------------------------------- */
/* Chart shape                                                                 */
/* -------------------------------------------------------------------------- */

export interface SizeChartRow {
  size: string;
  /** measurement key → value in inches, as typed. Missing keys are blank. */
  values: Record<string, string>;
}

export interface SizeChart {
  preset: string;
  measurements: string[];
  rows: SizeChartRow[];
  note: string;
}

export const EMPTY_SIZE_CHART: SizeChart = {
  preset: "tshirt",
  measurements: [],
  rows: [],
  note: "",
};

/**
 * Coerce whatever came out of the jsonb column into a usable chart.
 *
 * The column is free-form JSON, so this is the single place that decides what a
 * malformed or half-written chart means. Unknown measurement keys are dropped
 * rather than rendered as raw identifiers on the storefront.
 */
export function parseSizeChart(input: unknown): SizeChart {
  if (!input || typeof input !== "object") return { ...EMPTY_SIZE_CHART };
  const raw = input as Partial<SizeChart>;

  const measurements = Array.isArray(raw.measurements)
    ? raw.measurements.filter((k): k is string => typeof k === "string" && BY_KEY.has(k))
    : [];

  const rows = Array.isArray(raw.rows)
    ? raw.rows
        .filter((r): r is SizeChartRow => Boolean(r) && typeof r === "object")
        .map((r) => ({
          size: typeof r.size === "string" ? r.size : "",
          values:
            r.values && typeof r.values === "object"
              ? Object.fromEntries(
                  Object.entries(r.values)
                    .filter(([k, v]) => BY_KEY.has(k) && typeof v === "string")
                    .map(([k, v]) => [k, v.trim()])
                )
              : {},
        }))
        .filter((r) => r.size !== "")
    : [];

  return {
    preset: typeof raw.preset === "string" ? raw.preset : "custom",
    measurements,
    rows,
    note: typeof raw.note === "string" ? raw.note : "",
  };
}

/**
 * A chart is only worth showing if some size has some measurement filled in.
 * Guards the storefront against a toggle left on over an empty grid.
 */
export function hasSizeChartData(chart: SizeChart): boolean {
  return chart.rows.some((row) =>
    chart.measurements.some((key) => (row.values[key] ?? "").trim() !== "")
  );
}

/**
 * Drop measurement columns that no size filled in.
 *
 * Without this, selecting "Sleeve length" and never filling it would render an
 * entirely empty column on the storefront.
 */
export function populatedMeasurements(chart: SizeChart): string[] {
  return chart.measurements.filter((key) =>
    chart.rows.some((row) => (row.values[key] ?? "").trim() !== "")
  );
}

/** Rows with at least one value — a size left entirely blank is not a size. */
export function populatedRows(chart: SizeChart): SizeChartRow[] {
  return chart.rows.filter((row) =>
    chart.measurements.some((key) => (row.values[key] ?? "").trim() !== "")
  );
}

/* -------------------------------------------------------------------------- */
/* Units                                                                       */
/* -------------------------------------------------------------------------- */

const CM_PER_INCH = 2.54;

/**
 * Convert an as-typed inch value to cm, preserving ranges ("26-28" → "66-71").
 * Anything unparseable is passed through untouched rather than shown as NaN.
 */
export function inchesToCm(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const parts = trimmed.split(/\s*[-–]\s*/);
  const converted = parts.map((part) => {
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    // One decimal only when it earns its place: 66 reads better than 66.0.
    const cm = n * CM_PER_INCH;
    return (Math.round(cm * 10) / 10).toString();
  });

  if (converted.some((c) => c === null)) return trimmed;
  return converted.join("–");
}
