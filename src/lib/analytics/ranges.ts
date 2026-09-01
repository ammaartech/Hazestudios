/**
 * Date-range presets shared by the analytics dashboard and the report pages.
 *
 * Kept out of the client control components on purpose: server components call
 * `resolveRange` during rendering, and anything exported from a "use client"
 * module reaches the server as a client reference rather than the real function.
 */

import { formatDate } from "@/lib/format";

export const RANGE_PRESETS = [
  { value: "today", label: "Today", days: 1 },
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "12m", label: "Last 12 months", days: 365 },
] as const;

export type RangeValue = (typeof RANGE_PRESETS)[number]["value"];

export const DEFAULT_RANGE: RangeValue = "30d";

/** The `range` value that means "read the window off `from` and `to` instead". */
export const CUSTOM_RANGE = "custom";

export interface ResolvedPreset {
  value: string;
  label: string;
  days: number;
  /** True when the window came from explicit dates rather than a preset. */
  custom: boolean;
}

export interface ResolvedRange {
  from: Date;
  to: Date;
  preset: ResolvedPreset;
}

export function findPreset(value: string | undefined) {
  return (
    RANGE_PRESETS.find((p) => p.value === value) ??
    RANGE_PRESETS.find((p) => p.value === DEFAULT_RANGE)!
  );
}

/**
 * Parse a `<input type="date">` value as a *local* calendar day.
 *
 * `new Date("2026-06-01")` is parsed as UTC midnight, which in IST is already
 * 05:30 on the 1st — so a naive parse quietly shifts every custom window by a
 * day for anyone east of Greenwich. Splitting the parts and handing them to the
 * local-time constructor keeps "1 June" meaning 1 June where the admin sits.
 */
function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  // Rejects 2026-02-31 and friends, which the constructor happily rolls over.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1) return null;
  return date;
}

const DAY_MS = 86_400_000;

/**
 * Resolve a preset name — or an explicit `from`/`to` pair — to a concrete
 * window.
 *
 * Presets end *now*; a custom window ends at the close of its last day, so
 * picking today as the end date includes today's orders rather than cutting
 * them off at midnight. A custom range with a missing or unparseable date falls
 * back to the default preset instead of erroring: a half-typed date in the URL
 * should show a sane report, not a crash.
 */
export function resolveRange(
  value: string | undefined,
  fromParam?: string,
  toParam?: string
): ResolvedRange {
  if (value === CUSTOM_RANGE) {
    let start = parseDay(fromParam);
    let end = parseDay(toParam);

    if (start && end) {
      // A backwards range is a slip, not a request for no data.
      if (start > end) [start, end] = [end, start];
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      return {
        from: start,
        to: end,
        preset: {
          value: CUSTOM_RANGE,
          label: `${formatDate(start)} – ${formatDate(end)}`,
          days: Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1,
          custom: true,
        },
      };
    }
  }

  const preset = findPreset(value);

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (preset.days - 1));
  from.setHours(0, 0, 0, 0);

  return { from, to, preset: { ...preset, custom: false } };
}

/**
 * The range as it reads mid-sentence ("… showing last 30 days"). Preset labels
 * are sentence-cased and lowercase cleanly; a custom label carries month names
 * and must not.
 */
export function rangeCaption(preset: ResolvedPreset) {
  return preset.custom ? preset.label : preset.label.toLowerCase();
}
