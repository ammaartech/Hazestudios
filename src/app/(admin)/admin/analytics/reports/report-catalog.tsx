"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  FileText,
  Search,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  REPORT_CATEGORIES,
  type ReportDefinition,
} from "@/lib/analytics/report-definitions";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const VIEWS_KEY = "haze_report_views";

type Views = Record<string, string>;

/**
 * "Last viewed" is per-person and has no bearing on anyone else's admin, so it
 * lives in localStorage rather than earning a database table and a write on
 * every report open.
 *
 * Read through useSyncExternalStore, which is what localStorage is — an
 * external store. The parsed value is cached against its raw string so the
 * snapshot stays referentially stable; returning a fresh object each call would
 * spin React forever.
 */
const NO_VIEWS: Views = {};

let cachedRaw: string | null = null;
let cachedViews: Views = NO_VIEWS;

function readViews(): Views {
  try {
    const raw = localStorage.getItem(VIEWS_KEY) ?? "{}";
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedViews = JSON.parse(raw) as Views;
    }
    return cachedViews;
  } catch {
    return NO_VIEWS;
  }
}

function subscribeToViews(onChange: () => void) {
  // Fires when another tab records a view; same-tab writes land on next mount.
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Server render has no localStorage — a stable empty object, not a new one. */
const serverViews = () => NO_VIEWS;

export function recordReportView(slug: string) {
  try {
    const views = { ...readViews(), [slug]: new Date().toISOString() };
    localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
  } catch {
    // Storage unavailable — the column just stays empty.
  }
}

type SortKey = "name" | "category" | "lastViewed";

function FilterMenu({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 hover:bg-muted",
            selected && "border-foreground/30 bg-muted"
          )}
        >
          {selected ?? label}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem
          onClick={() => onSelect(null)}
          className="cursor-pointer"
        >
          <Check className={cn("size-4", selected ? "opacity-0" : "opacity-100")} />
          All
        </DropdownMenuItem>
        {options.map((option) => (
          <DropdownMenuItem
            key={option}
            onClick={() => onSelect(option)}
            className="cursor-pointer"
          >
            <Check
              className={cn(
                "size-4",
                selected === option ? "opacity-100" : "opacity-0"
              )}
            />
            {option}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Declared at module scope rather than inside ReportCatalog — a component
 * created during render is a new type on every pass and loses its state.
 */
function SortableHead({
  label,
  sortKey,
  activeKey,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex cursor-pointer items-center gap-1.5 transition-colors duration-150 hover:text-foreground"
      >
        {label}
        <ArrowUpDown
          className={cn(
            "size-3",
            sortKey === activeKey
              ? "text-foreground"
              : "text-muted-foreground/50"
          )}
        />
      </button>
    </TableHead>
  );
}

export function ReportCatalog({
  reports,
  createdBy,
}: {
  reports: ReportDefinition[];
  createdBy: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [author, setAuthor] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("category");
  const [ascending, setAscending] = useState(true);
  const views = useSyncExternalStore(subscribeToViews, readViews, serverViews);

  /**
   * Position in the catalog file, for the within-category tiebreak. That file
   * is authored deliberately — "Total orders" is written above "Orders by
   * city" because it is the one you reach for first — and sorting by name
   * inside a category would silently reverse the pair.
   */
  const declared = useMemo(
    () => new Map(reports.map((r, i) => [r.slug, i])),
    [reports]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = reports.filter((report) => {
      if (category && report.category !== category) return false;
      if (author && createdBy !== author) return false;
      if (!needle) return true;
      return (
        report.name.toLowerCase().includes(needle) ||
        report.description.toLowerCase().includes(needle) ||
        report.category.toLowerCase().includes(needle)
      );
    });

    const direction = ascending ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name) * direction;
      if (sort === "lastViewed") {
        // Never-viewed reports sort last in both directions — an empty cell is
        // not "oldest", it is absent.
        const av = views[a.slug];
        const bv = views[b.slug];
        if (!av && !bv) return a.name.localeCompare(b.name);
        if (!av) return 1;
        if (!bv) return -1;
        return (new Date(bv).getTime() - new Date(av).getTime()) * direction;
      }
      // Category, then the catalog's own order within it.
      const byCategory =
        REPORT_CATEGORIES.indexOf(a.category) -
        REPORT_CATEGORIES.indexOf(b.category);
      const byPosition =
        (declared.get(a.slug) ?? 0) - (declared.get(b.slug) ?? 0);
      return (byCategory || byPosition) * direction;
    });
  }, [
    reports,
    query,
    category,
    author,
    sort,
    ascending,
    views,
    createdBy,
    declared,
  ]);

  function toggleSort(key: SortKey) {
    if (sort === key) setAscending((prev) => !prev);
    else {
      setSort(key);
      setAscending(true);
    }
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports"
            aria-label="Search reports"
            className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <FilterMenu
            label="Created by"
            options={[createdBy]}
            selected={author}
            onSelect={setAuthor}
          />
          <FilterMenu
            label="Category"
            options={[...REPORT_CATEGORIES]}
            selected={category}
            onSelect={setCategory}
          />
          {(category || author || query) && (
            <button
              type="button"
              onClick={() => {
                setCategory(null);
                setAuthor(null);
                setQuery("");
              }}
              className="cursor-pointer px-2 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No reports match “{query}”.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label="Name"
                sortKey="name"
                activeKey={sort}
                onSort={toggleSort}
              />
              <SortableHead
                label="Category"
                sortKey="category"
                activeKey={sort}
                onSort={toggleSort}
                className="hidden sm:table-cell"
              />
              <SortableHead
                label="Last viewed"
                sortKey="lastViewed"
                activeKey={sort}
                onSort={toggleSort}
                className="hidden md:table-cell"
              />
              <TableHead className="hidden lg:table-cell">Created by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((report) => (
              <TableRow key={report.slug} className="group">
                {/* `whitespace-normal` because `TableCell` sets `nowrap` for
                    every other column in the admin, and here that held the
                    report's description on one 313px line — which at 320px is
                    wider than the table is allowed to be, so the only column
                    still showing at that width overflowed the screen. */}
                <TableCell className="whitespace-normal">
                  <Link
                    href={`/admin/analytics/reports/${report.slug}`}
                    className="flex items-start gap-2.5"
                  >
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block font-medium group-hover:underline">
                        {report.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {report.description}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant="secondary" className="font-normal">
                    {report.category}
                  </Badge>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {views[report.slug] ? formatDate(views[report.slug]) : "—"}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                  {createdBy}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
