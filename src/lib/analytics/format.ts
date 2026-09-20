import { DEFAULT_LOCALE, formatMoney } from "@/lib/format";

/**
 * Number formatting shared by the dashboard page (a server component) and its
 * charts (client components). Lives here rather than in the chart module
 * because a function exported from a "use client" file reaches the server as
 * a client reference, not something it can call.
 */

export type ValueFormat = "money" | "number" | "percent";

/** Compact axis values: "₹1.5L" / "2L" / "1.2%" — what fits a 40px gutter. */
export function compactValue(value: number, format: ValueFormat, currency = "INR") {
  if (format === "percent") {
    return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
  }
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    ...(format === "money" ? { style: "currency", currency } : {}),
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Full values for tooltips and headlines. */
export function fullValue(value: number, format: ValueFormat, currency = "INR") {
  if (format === "money") return formatMoney(value, currency);
  if (format === "percent") return `${value.toFixed(2)}%`;
  return new Intl.NumberFormat(DEFAULT_LOCALE).format(value);
}
