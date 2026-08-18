import type { WaitlistEntry } from "@/lib/types";
import { craftTicketLabel, isWaitlistStatus } from "@/lib/shop/waitlist";

/**
 * What the waitlist list and the CSV export have in common.
 *
 * They must agree on two things or the export button quietly lies: which rows a
 * given search and filter select, and what a column is called. Both live here
 * so "Export CSV" always means "export what I am looking at".
 */

export const PAGE_SIZE = 50;

/** PostgREST reads these as filter syntax, so they cannot reach a filter raw. */
export function sanitize(term: string): string {
  return term.replace(/[%,()*\\]/g, " ").trim();
}

export interface WaitlistFilters {
  term: string;
  status: string | undefined;
}

/** Reads the two filters off a route's search params, normalised. */
export function readFilters(params: {
  q?: string;
  status?: string;
}): WaitlistFilters {
  return {
    term: sanitize(params.q ?? ""),
    // An unknown status would silently return nothing; treat it as unfiltered.
    status:
      params.status && isWaitlistStatus(params.status) ? params.status : undefined,
  };
}

/**
 * Applies the filters to a PostgREST query builder.
 *
 * Typed loosely on purpose: the page builds a `select("*", { count })` and the
 * export builds a ranged `select(...)`, and Supabase's builder types differ
 * enough between the two that pinning this to one of them would force a cast at
 * the other call site instead of here.
 */
export function applyFilters<
  T extends {
    or(filter: string): T;
    eq(column: string, value: string): T;
  },
>(query: T, { term, status }: WaitlistFilters): T {
  let q = query;
  if (term) {
    // Phone and handle are searchable because that is how someone arrives in
    // the DMs — "hi it's @sana, am I on the list?" rarely comes with an email.
    q = q.or(
      `name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,instagram.ilike.%${term}%`
    );
  }
  if (status) q = q.eq("status", status);
  return q;
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

export const CSV_HEADERS = [
  "Position",
  "Name",
  "Email",
  "Phone",
  "Instagram",
  "Craft",
  "Other",
  "Status",
  "Source",
  "Signed up",
  "Notes",
] as const;

/**
 * Neutralises a value that a spreadsheet would run as a formula.
 *
 * A cell beginning `=`, `@`, `+` or `-` is executable in Excel, Sheets and
 * LibreOffice, and two of this table's columns are free text an anonymous
 * stranger typed into a public form — an Instagram handle of
 * `=HYPERLINK("http://…","click")` becomes a live link in the operator's
 * spreadsheet the moment they open the export. Prefixing with an apostrophe is
 * the standard fix.
 *
 * `+` and `-` are let through when what follows is plainly a phone number,
 * because otherwise every Indian number in the file would be exported as
 * `'+91 98765 43210`. A formula cannot hide in that shape: it has no letters,
 * no parentheses and no equals sign.
 */
function deFormula(value: string): string {
  if (!/^[=@\t\r]/.test(value) && !/^[+-]/.test(value)) return value;
  if (/^[+-][\d\s()-]*$/.test(value)) return value;
  return `'${value}`;
}

/** RFC 4180 quoting, plus the formula guard above. */
export function csvCell(value: string | number): string {
  const s = deFormula(String(value ?? ""));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(entry: WaitlistEntry): string[] {
  return [
    String(entry.position),
    entry.name,
    entry.email,
    entry.phone,
    // The bare handle, without the '@' the table shows. Two reasons: it is what
    // a bulk-DM or ads-audience tool wants pasted in, and prepending '@' would
    // make *every* handle start with a character `deFormula` has to neutralise,
    // so a clean export would come out as `'@aishamakes` on every single row.
    entry.instagram,
    craftTicketLabel(entry.craft),
    entry.craft_note,
    entry.status,
    entry.source,
    entry.created_at,
    entry.notes,
  ];
}

export function toCsv(entries: WaitlistEntry[]): string {
  const lines = [
    CSV_HEADERS.map(csvCell).join(","),
    ...entries.map((e) => csvRow(e).map(csvCell).join(",")),
  ];
  // CRLF: what RFC 4180 specifies, and what stops Excel on Windows reading the
  // whole file as one row.
  return lines.join("\r\n");
}
