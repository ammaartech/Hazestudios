/**
 * Date-range presets shared by the analytics dashboard and the report pages.
 *
 * Kept out of the client control components on purpose: server components call
 * `resolveRange` during rendering, and anything exported from a "use client"
 * module reaches the server as a client reference rather than the real function.
 */

import { formatDate } from "@/lib/format";

/**
 * The preset list mirrors Shopify's analytics picker. Two shapes of window:
 *
 *   rolling  "last N days" and the "to date" family end *now*, so today's
 *            orders are always in the picture;
 *   closed   yesterday, last month and last year end at the close of their last
 *            day — they are finished periods and must not move as the day goes on.
 */
export const RANGE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "365d", label: "Last 365 days" },
  { value: "last_month", label: "Last month" },
  { value: "12m", label: "Last 12 months" },
  { value: "last_year", label: "Last year" },
  { value: "wtd", label: "Week to date" },
  { value: "mtd", label: "Month to date" },
  { value: "qtd", label: "Quarter to date" },
  { value: "ytd", label: "Year to date" },
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

function findPreset(value: string | undefined) {
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

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function daysAgo(now: Date, days: number) {
  const d = startOfDay(now);
  d.setDate(d.getDate() - days);
  return d;
}

/** The concrete window a preset names, relative to `now`. */
function presetWindow(
  value: RangeValue,
  now = new Date()
): { from: Date; to: Date } {
  switch (value) {
    case "today":
      return { from: startOfDay(now), to: now };
    case "yesterday": {
      const y = daysAgo(now, 1);
      return { from: y, to: endOfDay(y) };
    }
    case "7d":
      return { from: daysAgo(now, 6), to: now };
    case "30d":
      return { from: daysAgo(now, 29), to: now };
    case "90d":
      return { from: daysAgo(now, 89), to: now };
    case "365d":
      return { from: daysAgo(now, 364), to: now };
    case "12m": {
      const from = startOfDay(now);
      from.setMonth(from.getMonth() - 12);
      return { from, to: now };
    }
    case "last_month": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      return { from, to };
    }
    case "last_year": {
      const from = new Date(now.getFullYear() - 1, 0, 1);
      const to = endOfDay(new Date(now.getFullYear() - 1, 11, 31));
      return { from, to };
    }
    case "wtd": {
      // Monday-start weeks, matching how the chart buckets snap.
      const from = daysAgo(now, (now.getDay() + 6) % 7);
      return { from, to: now };
    }
    case "mtd":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    case "qtd": {
      const quarterStart = Math.floor(now.getMonth() / 3) * 3;
      return { from: new Date(now.getFullYear(), quarterStart, 1), to: now };
    }
    case "ytd":
      return { from: new Date(now.getFullYear(), 0, 1), to: now };
  }
}

function spanDays(from: Date, to: Date) {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1);
}

/**
 * Resolve a preset name — or an explicit `from`/`to` pair — to a concrete
 * window.
 *
 * A custom window ends at the close of its last day, so picking today as the
 * end date includes today's orders rather than cutting them off at midnight. A
 * custom range with a missing or unparseable date falls back to the default
 * preset instead of erroring: a half-typed date in the URL should show a sane
 * report, not a crash.
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
      start = startOfDay(start);
      end = endOfDay(end);

      return {
        from: start,
        to: end,
        preset: {
          value: CUSTOM_RANGE,
          label: `${formatDate(start)} – ${formatDate(end)}`,
          days: spanDays(start, end),
          custom: true,
        },
      };
    }
  }

  const preset = findPreset(value);
  const { from, to } = presetWindow(preset.value);

  return {
    from,
    to,
    preset: { ...preset, days: spanDays(from, to), custom: false },
  };
}

/**
 * The range as it reads mid-sentence ("… showing last 30 days"). Preset labels
 * are sentence-cased and lowercase cleanly; a custom label carries month names
 * and must not.
 */
export function rangeCaption(preset: ResolvedPreset) {
  return preset.custom ? preset.label : preset.label.toLowerCase();
}

/**
 * A window as the dashboard's date pill and chart legends print it:
 * "1 Jan 2019–18 Jun 2026". Day-first because the store is Indian, and the
 * year is dropped from the start when both ends share it — "1–18 Jun 2026"
 * reads as one span rather than two dates.
 */
export function formatRangeLabel(from: Date, to: Date) {
  const full = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = sameYear && from.getMonth() === to.getMonth();
  const sameDay = sameMonth && from.getDate() === to.getDate();

  if (sameDay) return full.format(from);
  if (sameMonth) return `${from.getDate()}–${full.format(to)}`;
  if (sameYear) {
    const dayMonth = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
    });
    return `${dayMonth.format(from)}–${full.format(to)}`;
  }
  return `${full.format(from)}–${full.format(to)}`;
}

/** The comparison windows the dashboard offers against the selected range. */
export const COMPARE_MODES = [
  { value: "none", label: "No comparison" },
  { value: "previous_period", label: "Previous period" },
  { value: "previous_year", label: "Previous year" },
] as const;

export type CompareMode = (typeof COMPARE_MODES)[number]["value"];

/** Parse the `compare` search param; `1` is the value the old dashboard wrote. */
export function parseCompareMode(value: string | undefined): CompareMode {
  if (value === "1" || value === "previous_period") return "previous_period";
  if (value === "previous_year") return "previous_year";
  return "none";
}

/**
 * The window a comparison is drawn against. "Previous period" is the
 * immediately preceding window of equal length; "previous year" is the same
 * calendar dates one year earlier, which is what a seasonal business wants to
 * see against a festival month.
 */
export function compareWindow(
  from: Date,
  to: Date,
  mode: CompareMode
): { from: Date; to: Date } | null {
  if (mode === "none") return null;
  if (mode === "previous_year") {
    const prevFrom = new Date(from);
    prevFrom.setFullYear(prevFrom.getFullYear() - 1);
    const prevTo = new Date(to);
    prevTo.setFullYear(prevTo.getFullYear() - 1);
    return { from: prevFrom, to: prevTo };
  }
  const span = to.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - span - 1),
    to: new Date(from.getTime() - 1),
  };
}
