/**
 * Qikink "Product Variations" table → a partial product draft.
 *
 * Qikink has no product API and its CSV export bundles multiple products
 * together, so there is no clean file to import. What *is* clean is the
 * Product Variations modal itself: selecting the table and copying it pastes
 * as tab-separated text with a header row, one line per size/colour. This
 * turns that paste into enough of a draft to skip the SKU copy-paste — title
 * and per-variant Store SKU — while price, media and tags stay manual.
 *
 * Column names are matched case-insensitively so small header wording changes
 * on Qikink's side do not break this outright. Only `Name`, `Variation` and
 * `Store SKU` are read; `Product SKU`, `Design SKU`, `Image` and the cost
 * columns are ignored.
 */

export interface QikinkPasteOption {
  name: string;
  values: string[];
}

export interface QikinkPasteVariant {
  /** e.g. "Black / S" — already in Hazestudios' " / "-joined convention. */
  title: string;
  sku: string;
}

export interface QikinkPasteResult {
  title: string;
  options: QikinkPasteOption[];
  variants: QikinkPasteVariant[];
  /** Rows dropped for missing a Store SKU or a malformed Variation column. */
  errors: string[];
  rowCount: number;
}

/** Splits pasted table text into rows/cells. No quoting to handle — this is a browser table selection, not a CSV file. */
function splitRows(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((cells) => cells.some((c) => c.trim() !== ""));
}

function findColumn(header: string[], name: string): number {
  const target = name.trim().toLowerCase();
  return header.findIndex((h) => h.trim().toLowerCase() === target);
}

export function parseQikinkPaste(text: string): QikinkPasteResult {
  const rows = splitRows(text);
  const errors: string[] = [];

  if (rows.length < 2) {
    return {
      title: "",
      options: [],
      variants: [],
      errors: ["Paste the Product Variations table, including its header row."],
      rowCount: 0,
    };
  }

  const [header, ...dataRows] = rows;
  const nameCol = findColumn(header, "Name");
  const variationCol = findColumn(header, "Variation");
  const skuCol = findColumn(header, "Store SKU");

  if (nameCol < 0 || variationCol < 0 || skuCol < 0) {
    return {
      title: "",
      options: [],
      variants: [],
      errors: [
        "Could not find the Name, Variation and Store SKU columns. Paste the table exactly as copied from Qikink.",
      ],
      rowCount: 0,
    };
  }

  let title = "";
  // Option values in first-seen order, per segment position (Colour, Size, …).
  const valuesBySegment: string[][] = [];
  const variants: QikinkPasteVariant[] = [];
  // Every row must split into the same number of segments — a mismatch means
  // Hazestudios' cartesian(options) will never generate that row's exact
  // combination, leaving its SKU as a dead, unreachable override.
  let segmentCount: number | null = null;

  dataRows.forEach((cells, i) => {
    const rowNumber = i + 2; // account for the header row, 1-indexed for humans
    const name = (cells[nameCol] ?? "").trim();
    const variation = (cells[variationCol] ?? "").trim();
    const sku = (cells[skuCol] ?? "").trim();

    if (!name && !variation && !sku) return; // blank line

    if (!title && name) title = name;

    const segments = variation
      .split(" - ")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!segments.length) {
      errors.push(`Row ${rowNumber}: no Variation value — skipped.`);
      return;
    }
    if (!sku) {
      errors.push(`Row ${rowNumber} (${variation || "unnamed"}): no Store SKU — skipped.`);
      return;
    }
    if (segmentCount === null) {
      segmentCount = segments.length;
    } else if (segments.length !== segmentCount) {
      errors.push(
        `Row ${rowNumber} ("${variation}"): has ${segments.length} part${segments.length === 1 ? "" : "s"}, expected ${segmentCount} — skipped.`
      );
      return;
    }

    segments.forEach((value, segIndex) => {
      const bucket = (valuesBySegment[segIndex] ??= []);
      if (!bucket.includes(value)) bucket.push(value);
    });

    variants.push({ title: segments.join(" / "), sku });
  });

  const options: QikinkPasteOption[] = valuesBySegment.map((values, i) => ({
    name: `Option ${i + 1}`,
    values,
  }));

  return { title, options, variants, errors, rowCount: dataRows.length };
}
