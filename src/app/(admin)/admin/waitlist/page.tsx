import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { Pagination } from "@/components/admin/pagination";
import { SearchInput } from "@/components/admin/search-input";
import { FilterTabs } from "@/components/admin/filter-tabs";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import {
  EVENT,
  SEATS,
  WAITLIST_STATUSES,
  craftTicketLabel,
} from "@/lib/shop/waitlist";
import type { WaitlistEntry, WaitlistStatus } from "@/lib/types";
import { PAGE_SIZE, applyFilters, readFilters } from "./query";
import { StatusSelect } from "./status-select";

export const metadata = { title: "Waitlist" };

const BASE = "/admin/waitlist";

/**
 * The Summer Sands waitlist.
 *
 * Reads on the request-scoped client, so the `is_staff()` policies from
 * 0024_waitlist.sql are what permit it. A signed-in *shopper* who reached this
 * URL would be turned away by `src/proxy.ts` first and, failing that, would get
 * an empty table rather than a list of other people's phone numbers.
 */
export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const filters = readFilters(params);
  const page = Math.max(0, parseInt(params.page ?? "0", 10) || 0);

  const supabase = await createClient();

  // The filtered page of rows, and — separately — the unfiltered tallies behind
  // the tabs. `head: true` means each count is a `COUNT(*)` with no rows on the
  // wire, so five of them cost less than one extra page of data.
  const [{ data, count }, tallies] = await Promise.all([
    applyFilters(
      supabase
        .from("waitlist_entries")
        .select("*", { count: "exact" })
        .order("position", { ascending: true }),
      filters
    ).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
    Promise.all(
      WAITLIST_STATUSES.map(async (s) => {
        const { count: n } = await supabase
          .from("waitlist_entries")
          .select("id", { count: "exact", head: true })
          .eq("status", s.id);
        return [s.id, n ?? 0] as const;
      })
    ),
  ]);

  const entries = (data ?? []) as WaitlistEntry[];
  const total = count ?? 0;
  const byStatus = Object.fromEntries(tallies) as Record<WaitlistStatus, number>;
  const signups = WAITLIST_STATUSES.reduce((n, s) => n + byStatus[s.id], 0);

  // What the export button should fetch: the same q and status the operator is
  // looking at, so the file matches the screen.
  const exportQuery = new URLSearchParams();
  if (params.q) exportQuery.set("q", params.q);
  if (filters.status) exportQuery.set("status", filters.status);
  const exportHref = `${BASE}/export${exportQuery.size ? `?${exportQuery}` : ""}`;

  const filtered = Boolean(filters.term || filters.status);

  return (
    <div>
      <PageHeader title="Waitlist">
        {/*
          A plain link, not a fetch: the browser's own download machinery
          handles the Content-Disposition, so there is no blob to build in
          memory and no state to get wrong. `download` is advisory here — the
          filename on the response wins — but it keeps the click from ever
          navigating the admin away if the header is missing.
        */}
        <Button variant="outline" asChild>
          <a href={exportHref} download>
            <Download className="size-4" />
            Export CSV
          </a>
        </Button>
      </PageHeader>

      {/* Five stat cards at `grid-cols-2` is three rows and about 400px of a
          phone screen spent before the list it describes begins. As a strip
          they are one row, and the two that matter — signed up, seats left —
          are the two that are on screen. */}
      <div className="strip mb-4 gap-3 [--strip-gutter:--spacing(4)] md:grid md:grid-cols-3 lg:grid-cols-5">
        <Stat label="Signed up" value={signups} />
        <Stat
          label="Seats left"
          value={Math.max(0, SEATS - signups)}
          hint={`of ${SEATS}`}
        />
        {WAITLIST_STATUSES.filter((s) => s.id !== "waiting").map((s) => (
          <Stat key={s.id} label={s.label} value={byStatus[s.id]} />
        ))}
      </div>

      <Card>
        <CardContent className="pt-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <FilterTabs
              basePath={BASE}
              param="status"
              current={filters.status}
              tabs={[
                { label: "All", value: undefined },
                ...WAITLIST_STATUSES.map((s) => ({
                  label: s.label,
                  value: s.id as string,
                })),
              ]}
            />
            <SearchInput placeholder="Search name, email, phone or handle" />
          </div>

          <p className="mb-3 text-sm text-muted-foreground tabular-nums">
            {total.toLocaleString()} {total === 1 ? "entry" : "entries"}
            {filtered && " matching"}
          </p>

          {entries.length === 0 ? (
            <div className="py-16 text-center">
              {/* A fruitless filter and an empty list need different next
                  steps, so they do not share a message. */}
              {filtered ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    No entries match this search.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" asChild>
                    <Link href={BASE}>Clear filters</Link>
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Nobody has signed up yet. Entries appear here as they come in
                    from the {EVENT.name} page.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" asChild>
                    <Link href="/waitlist">View the sign-up page</Link>
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              {/*
                Eight columns of contact details do not survive a 390px screen.
                The table scrolls, so nothing was strictly lost, but everything
                past "Email" — the phone number, the handle, the craft and the
                status control that is the only thing you can actually *do*
                here — sat off the right edge unannounced.

                Stacked instead, in the order the entry is read: who they are,
                how to reach them, what they asked for. The status select keeps
                the top-right corner because it is the row's one action.
              */}
              <ul className="-mx-2 divide-y md:hidden">
                {entries.map((e) => (
                  <li key={e.id} className="px-2 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-2">
                          <span className="shrink-0 text-[13px] font-medium tabular-nums text-muted-foreground">
                            {e.position}
                          </span>
                          <span className="truncate text-[15px] font-medium text-foreground">
                            {e.name || "—"}
                          </span>
                        </p>
                        <a
                          href={`mailto:${e.email}`}
                          className="mt-0.5 block truncate text-[13px] text-muted-foreground"
                        >
                          {e.email}
                        </a>
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                          <a href={`tel:${e.phone.replace(/[^\d+]/g, "")}`} className="tabular-nums">
                            {e.phone}
                          </a>
                          {e.instagram && (
                            <>
                              {" · "}
                              <a
                                href={`https://instagram.com/${e.instagram}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                @{e.instagram}
                              </a>
                            </>
                          )}
                        </p>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">
                          {craftTicketLabel(e.craft)}
                          {" · "}
                          {formatDateTime(e.created_at)}
                          {e.craft_note ? (
                            <span className="block italic text-muted-foreground/80">
                              {e.craft_note}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="shrink-0">
                        <StatusSelect id={e.id} status={e.status} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* The table is wider than a laptop sidebar leaves room for once
                  phone numbers and timestamps are in it, so it scrolls in its
                  own box rather than pushing the admin shell sideways. */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Instagram</TableHead>
                      <TableHead>Craft</TableHead>
                      <TableHead>Signed up</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium tabular-nums text-muted-foreground">
                          {e.position}
                        </TableCell>
                        {/* Blank for anyone who signed up before the form
                            asked; an em dash rather than nothing, so the column
                            reads as empty rather than broken. */}
                        <TableCell className="font-medium text-foreground">
                          {e.name || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {/* The one address they gave: worth being able to
                              click rather than retype. */}
                          <a
                            href={`mailto:${e.email}`}
                            className="transition-colors duration-150 hover:text-primary hover:underline"
                          >
                            {e.email}
                          </a>
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          <a
                            href={`tel:${e.phone.replace(/[^\d+]/g, "")}`}
                            className="transition-colors duration-150 hover:text-primary hover:underline"
                          >
                            {e.phone}
                          </a>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.instagram ? (
                            <a
                              href={`https://instagram.com/${e.instagram}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="transition-colors duration-150 hover:text-primary hover:underline"
                            >
                              @{e.instagram}
                            </a>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {craftTicketLabel(e.craft)}
                          {/* What they typed into "other". Shown under the
                              craft rather than in a column of its own, which
                              would be empty on almost every row. */}
                          {e.craft_note ? (
                            <span className="block text-xs italic text-muted-foreground/80">
                              {e.craft_note}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDateTime(e.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end">
                            <StatusSelect id={e.id} status={e.status} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    // `min-w-36` applies only inside the strip — a grid cell is sized by its
    // track, so above `md` this is inert.
    <Card className="min-w-36">
      <CardContent className="px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums leading-none text-foreground">
          {value.toLocaleString()}
          {hint && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {hint}
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
