/**
 * Numeric form values are held as strings.
 *
 * A `number` state field fights the operator: typing "10." round-trips through
 * NaN, clearing the box yields 0 rather than empty, and a leading "." is
 * rejected mid-keystroke. Parsing happens once, on the way to the database.
 *
 * Deliberately not a client module — the edit page maps DB rows to draft
 * strings on the server, and the form parses them back in the browser.
 */

/** "" → null, so an empty compare-at clears the column instead of writing 0. */
export function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Same, but for fields the schema declares NOT NULL. */
export function toAmount(value: string): number {
  return toNumber(value) ?? 0;
}

export function fromNumber(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}
