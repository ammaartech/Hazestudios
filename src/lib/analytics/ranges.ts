/**
 * Date-range presets shared by the analytics dashboard and the report pages.
 *
 * Kept out of the client control components on purpose: server components call
 * `resolveRange` during rendering, and anything exported from a "use client"
 * module reaches the server as a client reference rather than the real function.
 */

export const RANGE_PRESETS = [
  { value: "today", label: "Today", days: 1 },
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "12m", label: "Last 12 months", days: 365 },
] as const;

export type RangeValue = (typeof RANGE_PRESETS)[number]["value"];

export const DEFAULT_RANGE: RangeValue = "30d";

export function findPreset(value: string | undefined) {
  return (
    RANGE_PRESETS.find((p) => p.value === value) ??
    RANGE_PRESETS.find((p) => p.value === DEFAULT_RANGE)!
  );
}

/** Resolve a preset name to a concrete window ending now. */
export function resolveRange(value: string | undefined) {
  const preset = findPreset(value);

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (preset.days - 1));
  from.setHours(0, 0, 0, 0);

  return { from, to, preset };
}
