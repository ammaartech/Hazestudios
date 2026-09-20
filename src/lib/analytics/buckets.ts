/**
 * Time bucketing for the analytics charts.
 *
 * One rule for every time series on the dashboard, so "Sessions over time" and
 * "Orders over time" always share an x-axis: the same window produces the same
 * bucket edges, the same tooltip labels and the same axis ticks.
 */

export type Bucket = "hour" | "day" | "week" | "month";

/** Bucket width that keeps a chart readable across a day or seven years. */
export function bucketFor(from: Date, to: Date): Bucket {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 2) return "hour";
  if (days <= 90) return "day";
  if (days <= 730) return "week";
  return "month";
}

/** The start of the bucket a moment falls in. */
export function bucketKey(date: Date, bucket: Bucket) {
  const d = new Date(date);
  if (bucket === "hour") {
    d.setMinutes(0, 0, 0);
  } else if (bucket === "week") {
    d.setHours(0, 0, 0, 0);
    // Snap to Monday so week buckets line up with how merchants read a week.
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  } else if (bucket === "month") {
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

function advance(date: Date, bucket: Bucket) {
  const next = new Date(date);
  if (bucket === "hour") next.setHours(next.getHours() + 1);
  else if (bucket === "day") next.setDate(next.getDate() + 1);
  else if (bucket === "week") next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

/** The label a tooltip shows for a bucket: specific enough to act on. */
function bucketLabel(date: Date, bucket: Bucket) {
  if (bucket === "hour") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
    }).format(date);
  }
  if (bucket === "month") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
    }).format(date);
  }
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  return bucket === "week" ? `Week of ${day}` : day;
}

export interface SeededBucket {
  /** Bucket start, ISO. */
  date: string;
  /** Tooltip label. */
  label: string;
  /** Axis label; empty for buckets that do not get a tick. */
  tick: string;
}

/**
 * Every bucket edge in the window, oldest first, so gaps render as zero instead
 * of collapsing the axis. Ticks are chosen here rather than by the chart:
 * roughly six labels per axis, and one per January once the window spans more
 * than two years, which is what turns a seven-year sales line into "2019 … 2025"
 * instead of eighty-four month names fighting for space.
 */
export function seedBuckets(from: Date, to: Date, bucket: Bucket): SeededBucket[] {
  const starts: Date[] = [];
  for (let cursor = bucketKey(from, bucket); cursor <= to; cursor = advance(cursor, bucket)) {
    starts.push(cursor);
  }

  const n = starts.length;
  const yearly = bucket === "month" && n > 24;
  const stride = Math.max(1, Math.ceil(n / 6));

  const tickFormat =
    bucket === "hour"
      ? new Intl.DateTimeFormat("en-US", { hour: "numeric" })
      : bucket === "month"
        ? new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" })
        : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

  return starts.map((start, i) => {
    let tick = "";
    if (yearly) {
      if (start.getMonth() === 0) tick = String(start.getFullYear());
    } else if (i % stride === 0) {
      tick = tickFormat.format(start);
    }
    return { date: start.toISOString(), label: bucketLabel(start, bucket), tick };
  });
}
