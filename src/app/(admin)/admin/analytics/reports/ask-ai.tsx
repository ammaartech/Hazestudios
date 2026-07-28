"use client";

import { useRef, useState, useTransition } from "react";
import {
  ChevronDown,
  CodeXml,
  CornerDownLeft,
  Loader2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DEFAULT_LOCALE } from "@/lib/format";
import { CsvExportButton } from "./report-controls";
import { askForReport, type AskResult } from "./ask-actions";

/**
 * "Ask for a report" — a question box above the report catalog.
 *
 * The catalog answers the nineteen questions someone thought to build a runner
 * for. This answers the twentieth, by handing the question to Gemini, turning it
 * into SQL, and running that SQL read-only. See `ask-actions.ts` for the gate and
 * `lib/analytics/sql-guard.ts` for what the model is not allowed to produce.
 *
 * The generated SQL is always one toggle away from visible, deliberately. A
 * number whose derivation nobody can inspect is not a report, it is a rumour —
 * and the merchant is the only one who can tell whether "sales" was supposed to
 * include the partially-refunded order.
 */

/** Seeds the box so the first use is a click, not a blank page. The date in the
 *  third one is deliberate — it shows that a literal range works. */
const EXAMPLES = [
  "Highest selling product from 1/06/2026 to today",
  "Revenue by month this year",
  "Which products are almost out of stock?",
  "Top 10 customers by spend in the last 90 days",
];

export function AskAi() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function run(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    // Collapse the SQL panel between runs — leaving the previous query open
    // above a new result reads as if it produced it.
    setShowSql(false);
    startTransition(async () => {
      setResult(await askForReport(trimmed));
    });
  }

  // Not named `useExample` — the `use` prefix makes rules-of-hooks treat a
  // plain handler as a hook and reject the call from inside onClick.
  function fillFromExample(example: string) {
    setQuestion(example);
    inputRef.current?.focus();
    run(example);
  }

  const success = result?.ok ? result : null;
  const failure = result && !result.ok ? result : null;

  return (
    <section className="mb-5 rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-3">
        <div className="flex items-start gap-2.5">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Ask for a report</h2>
            <p className="mt-0.5 max-w-[70ch] text-xs text-muted-foreground">
              Describe the report you want in plain English. It is turned into a
              read-only SQL query and run against your store data.
            </p>
          </div>
        </div>
      </div>

      <div className="p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(question);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <div className="relative min-w-60 flex-1">
            <label htmlFor="ask-question" className="sr-only">
              Describe the report you want
            </label>
            <input
              id="ask-question"
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Report for highest selling product from 1/06/2026 to today"
              autoComplete="off"
              maxLength={500}
              className="h-9 w-full rounded-lg border bg-background pl-3 pr-9 text-sm outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            />
            <CornerDownLeft
              aria-hidden
              className={cn(
                "pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 transition-opacity duration-150",
                question.trim() ? "text-muted-foreground" : "opacity-0"
              )}
            />
          </div>
          <Button type="submit" size="lg" disabled={pending || !question.trim()}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Building
              </>
            ) : (
              "Build report"
            )}
          </Button>
        </form>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Try</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={pending}
              onClick={() => fillFromExample(example)}
              className="cursor-pointer rounded-lg border px-2 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {/* Results replace each other in place, so the region is announced live. */}
      <div aria-live="polite">
        {pending && <PendingResult />}

        {!pending && failure && (
          <div className="border-t p-3">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p>{failure.message}</p>
            </div>
            {failure.sql && <SqlBlock sql={failure.sql} className="mt-3" />}
          </div>
        )}

        {!pending && success && (
          <SuccessResult
            result={success}
            showSql={showSql}
            onToggleSql={() => setShowSql((v) => !v)}
          />
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Result rendering                                                            */
/* -------------------------------------------------------------------------- */

/** A skeleton shaped like the table that is coming, rather than a spinner in the
 *  middle of the panel. */
function PendingResult() {
  return (
    <div className="border-t p-3">
      <Skeleton className="h-4 w-52" />
      <Skeleton className="mt-2 h-3 w-80" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}

function SuccessResult({
  result,
  showSql,
  onToggleSql,
}: {
  result: Extract<AskResult, { ok: true }>;
  showSql: boolean;
  onToggleSql: () => void;
}) {
  const { title, explanation, sql, columns, rows, truncated, maxRows } = result;

  return (
    <div className="border-t">
      <div className="flex flex-wrap items-start justify-between gap-3 p-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {explanation && (
            <p className="mt-0.5 max-w-[75ch] text-xs text-muted-foreground">
              {explanation}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onToggleSql}>
            <CodeXml className="size-3.5" />
            {showSql ? "Hide SQL" : "Show SQL"}
            <ChevronDown
              aria-hidden
              className={cn(
                "size-3.5 transition-transform duration-200",
                showSql && "rotate-180"
              )}
            />
          </Button>
          <CsvExportButton
            headers={columns.map((c) => c.name)}
            // The export carries the raw values; nulls become empty cells rather
            // than the em dash the table shows.
            rows={rows.map((row) => row.map((cell) => (cell === null ? "" : String(cell))))}
            filename={`${slugify(title)}.csv`}
          />
        </div>
      </div>

      {showSql && <SqlBlock sql={sql} className="px-3 pb-3" />}

      {rows.length === 0 ? (
        <p className="border-t py-12 text-center text-sm text-muted-foreground">
          The query ran, but no rows matched.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((column, i) => (
                    <TableHead
                      key={`${column.name}-${i}`}
                      className={cn(column.kind === "number" && "text-right")}
                    >
                      {column.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, r) => (
                  <TableRow key={r}>
                    {row.map((cell, c) => {
                      const kind = columns[c]?.kind ?? "text";
                      return (
                        <TableCell
                          key={c}
                          className={cn(
                            kind === "number" && "text-right tabular-nums",
                            kind === "date" && "tabular-nums whitespace-nowrap"
                          )}
                        >
                          {formatCell(cell, kind)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {truncated
              ? `Showing the first ${maxRows.toLocaleString()} rows — narrow the question for the rest.`
              : `${rows.length.toLocaleString()} ${rows.length === 1 ? "row" : "rows"}`}
          </p>
        </>
      )}
    </div>
  );
}

function SqlBlock({ sql, className }: { sql: string; className?: string }) {
  return (
    <div className={className}>
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
        <code className="font-mono">{sql}</code>
      </pre>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cells                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Numbers get thousands separators; everything else is printed as the database
 * returned it.
 *
 * No currency formatting on purpose. Nothing in a result set says which columns
 * are money — "Total orders" is a count, "Total" is not — so the model is asked
 * to name the currency in the column header instead of this guessing and
 * stamping a dollar sign on a quantity.
 */
function formatCell(
  value: string | number | boolean | null,
  kind: "number" | "date" | "boolean" | "text"
) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  if (kind === "boolean") return value ? "Yes" : "No";
  if (kind === "number" && typeof value === "number") {
    return value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 2 });
  }
  return String(value);
}

function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "report"
  );
}
