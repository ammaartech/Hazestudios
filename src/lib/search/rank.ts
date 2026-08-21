import { matchItem, prepareQuery, unit } from "./fuzzy";
import {
  GROUP_LABEL,
  GROUP_ORDER,
  type IndexedItem,
  type Result,
  type ResultKind,
} from "./types";

/**
 * Turns a query plus both tiers into the grouped list the dropdown renders.
 *
 * Pure, and separate from the component on purpose: this is where the two tiers
 * are reconciled, and reconciliation logic that lives inside a `useMemo` is
 * logic nothing can test.
 */

export interface Group {
  kind: ResultKind;
  label: string;
  items: Result[];
}

/**
 * How many rows each group may contribute.
 *
 * Per group rather than one overall limit, so a query that matches four hundred
 * products cannot bury the single order that also matched. The numbers are
 * sized so the whole list stays scannable without scrolling in the common case.
 */
const CAPS: Record<ResultKind, number> = {
  product: 6,
  order: 5,
  customer: 5,
  collection: 3,
  page: 4,
};

/** Below this a match is technically real but not worth a row. */
const FLOOR = 0.08;

function score(item: IndexedItem, query: ReturnType<typeof prepareQuery>) {
  if (!query) return null;
  const m = matchItem(query, item.fields, item.boost);
  if (!m) return null;
  return { unit: unit(m), ranges: m.ranges, via: m.via };
}

export function buildGroups({
  query,
  local,
  remote,
}: {
  query: string;
  /** Products, collections and commands, already prepared for matching. */
  local: IndexedItem[];
  /** Rows from `admin_search`, already on the 0..1 scale. */
  remote: Result[];
}): Group[] {
  const q = prepareQuery(query);
  if (!q) return [];

  const byKey = new Map<string, Result>();

  for (const item of local) {
    const matched = score(item, q);
    if (!matched || matched.unit < FLOOR) continue;

    byKey.set(`${item.kind}:${item.id}`, {
      kind: item.kind,
      id: item.id,
      href: item.href,
      title: item.title,
      subtitle: item.subtitle,
      meta: item.meta,
      image: item.image,
      score: matched.unit,
      ranges: matched.ranges,
      via: matched.via,
    });
  }

  for (const row of remote) {
    const key = `${row.kind}:${row.id}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, row);
      continue;
    }

    // Both tiers found the same product — the catalogue matched its title and
    // `admin_search` matched a variant SKU. The local row is the richer one (it
    // carries a cover image and highlight ranges), so it is kept; only the
    // score is raised, and the SKU is surfaced as the reason it matched, which
    // is the part the local row could not know.
    byKey.set(key, {
      ...existing,
      score: Math.max(existing.score, row.score),
      via: row.subtitle?.startsWith("SKU") ? "SKU" : existing.via,
      subtitle: existing.subtitle ?? row.subtitle,
    });
  }

  const grouped = new Map<ResultKind, Result[]>();
  for (const result of byKey.values()) {
    const list = grouped.get(result.kind);
    if (list) list.push(result);
    else grouped.set(result.kind, [result]);
  }

  const groups: Group[] = [];
  for (const [kind, items] of grouped) {
    items.sort((a, b) => b.score - a.score);
    groups.push({
      kind,
      label: GROUP_LABEL[kind],
      items: items.slice(0, CAPS[kind]),
    });
  }

  /*
   * Groups are ordered by their strongest result, not by a fixed list.
   *
   * This is what makes the dropdown feel like it understands the query rather
   * than like it has a layout. Typing "7586" puts Orders at the top; typing
   * "hoodie" puts Products there; typing "shipping" puts Go to there. A fixed
   * order would mean an exact order-number match rendering below six loose
   * product matches, which is the single most annoying thing a search can do.
   *
   * GROUP_ORDER survives as the tiebreak, so groups whose best results are
   * genuinely comparable keep a stable, familiar arrangement instead of
   * reshuffling as the scores wobble between keystrokes.
   */
  groups.sort((a, b) => {
    const delta = b.items[0].score - a.items[0].score;
    if (Math.abs(delta) > 0.02) return delta;
    return GROUP_ORDER.indexOf(a.kind) - GROUP_ORDER.indexOf(b.kind);
  });

  return groups;
}
