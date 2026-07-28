"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  chunkProducts,
  parseShopifyCsv,
  type ParseResult,
} from "@/lib/product-csv";
import {
  beginImport,
  finishImport,
  importChunk,
  recordProgress,
  type ImportTotals,
} from "./import-actions";

type Phase = "choose" | "reading" | "preview" | "importing" | "done";

const MAX_BYTES = 25 * 1024 * 1024;

const EMPTY_TOTALS: ImportTotals = {
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  errors: [],
};

export function ImportDialog({
  open,
  onOpenChange,
  currency = "INR",
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency?: string;
  /** Called once the run finishes, so the list behind the dialog can refresh. */
  onImported: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("choose");
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(true);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [totals, setTotals] = useState<ImportTotals>(EMPTY_TOTALS);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase("choose");
    setFile(null);
    setParsed(null);
    setFatal(null);
    setDone(0);
    setTotals(EMPTY_TOTALS);
    setDragging(false);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  /** A run in flight owns the dialog: closing it would orphan the remaining chunks. */
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && phase === "importing") return;
      if (!next) reset();
      onOpenChange(next);
    },
    [phase, reset, onOpenChange]
  );

  const readFile = useCallback(async (chosen: File) => {
    setFile(chosen);
    setFatal(null);

    if (chosen.size > MAX_BYTES) {
      setFatal(
        `That file is ${(chosen.size / 1024 / 1024).toFixed(1)} MB. Split exports larger than 25 MB.`
      );
      setPhase("choose");
      return;
    }

    setPhase("reading");
    try {
      const text = await chosen.text();
      const result = parseShopifyCsv(text);
      setParsed(result);
      // A file with no usable products is a dead end, not a preview.
      setPhase(result.products.length ? "preview" : "choose");
      if (!result.products.length) {
        setFatal(result.errors[0]?.message ?? "No products found in that file.");
      }
    } catch {
      setFatal("That file could not be read as text. Export it as CSV, not XLSX.");
      setPhase("choose");
    }
  }, []);

  const runImport = useCallback(async () => {
    if (!parsed?.products.length) return;

    setPhase("importing");
    setDone(0);

    const chunks = chunkProducts(parsed.products);
    const begun = await beginImport(file?.name ?? "products.csv", parsed.products.length);

    if (!begun.ok) {
      setFatal(begun.error);
      setPhase("preview");
      return;
    }

    const runId = begun.data.runId;
    let running: ImportTotals = { ...EMPTY_TOTALS, errors: [] };
    let aborted = false;

    for (const [index, chunk] of chunks.entries()) {
      const result = await importChunk(runId, chunk, overwrite);

      if (!result.ok) {
        // A transport-level failure loses the whole chunk, so it is reported as
        // that many failures rather than passed over in silence.
        running = {
          ...running,
          failed: running.failed + chunk.length,
          errors: [...running.errors, { handle: `batch ${index + 1}`, message: result.error }],
        };
        aborted = true;
        setTotals(running);
        break;
      }

      running = {
        created: running.created + result.data.created,
        updated: running.updated + result.data.updated,
        skipped: running.skipped + result.data.skipped,
        failed: running.failed + result.data.failed,
        errors: [...running.errors, ...result.data.errors],
      };

      setTotals(running);
      setDone((n) => n + chunk.length);
      await recordProgress(runId, running);
    }

    await finishImport(runId, running, aborted);
    setPhase("done");
    onImported();
  }, [parsed, file, overwrite, onImported]);

  const total = parsed?.products.length ?? 0;
  const percent = total ? Math.round((done / total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        showCloseButton={phase !== "importing"}
        onInteractOutside={(e) => phase === "importing" && e.preventDefault()}
        onEscapeKeyDown={(e) => phase === "importing" && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Import products by CSV</DialogTitle>
          <DialogDescription>
            Takes a Shopify product export. Products are matched by handle.
          </DialogDescription>
        </DialogHeader>

        {(phase === "choose" || phase === "reading") && (
          <ChooseStep
            dragging={dragging}
            reading={phase === "reading"}
            file={file}
            fatal={fatal}
            overwrite={overwrite}
            inputRef={inputRef}
            onOverwriteChange={setOverwrite}
            onDraggingChange={setDragging}
            onFile={readFile}
          />
        )}

        {phase === "preview" && parsed && (
          <PreviewStep parsed={parsed} currency={currency} fatal={fatal} />
        )}

        {phase === "importing" && (
          <ProgressStep done={done} total={total} percent={percent} totals={totals} />
        )}

        {phase === "done" && <ResultStep totals={totals} />}

        <DialogFooter>
          {phase === "preview" && (
            <>
              <Button variant="outline" onClick={reset}>
                Choose another file
              </Button>
              <Button onClick={runImport}>
                Import {parsed?.products.length.toLocaleString()} product
                {parsed?.products.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
          {phase === "importing" && (
            <Button disabled>Importing… don&rsquo;t close this window</Button>
          )}
          {phase === "done" && (
            <>
              <Button variant="outline" onClick={reset}>
                Import another file
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </>
          )}
          {(phase === "choose" || phase === "reading") && (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                       */
/* -------------------------------------------------------------------------- */

function ChooseStep({
  dragging,
  reading,
  file,
  fatal,
  overwrite,
  inputRef,
  onOverwriteChange,
  onDraggingChange,
  onFile,
}: {
  dragging: boolean;
  reading: boolean;
  file: File | null;
  fatal: string | null;
  overwrite: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onOverwriteChange: (v: boolean) => void;
  onDraggingChange: (v: boolean) => void;
  onFile: (file: File) => void;
}) {
  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          onDraggingChange(true);
        }}
        onDragLeave={() => onDraggingChange(false)}
        onDrop={(e) => {
          e.preventDefault();
          onDraggingChange(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) onFile(dropped);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-input hover:bg-muted/50",
          reading && "pointer-events-none opacity-60"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) onFile(chosen);
          }}
        />
        {reading ? (
          <>
            <FileSpreadsheet className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Reading {file?.name}…</p>
          </>
        ) : (
          <>
            <Upload className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">
              Drop a CSV here, or click to choose one
            </p>
            <p className="text-xs text-muted-foreground">
              Shopify: Products → Export → CSV for Excel, Numbers, or other
              spreadsheet programs
            </p>
          </>
        )}
      </label>

      {fatal && <Callout tone="error">{fatal}</Callout>}

      <label className="flex cursor-pointer items-start gap-2.5">
        <Checkbox
          checked={overwrite}
          onCheckedChange={(v) => onOverwriteChange(v === true)}
          className="mt-0.5"
        />
        <span className="text-sm leading-snug">
          Overwrite products with the same handle
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {overwrite
              ? "Existing products are updated in place — their title, media, variants and pricing are replaced by the file."
              : "Existing products are left untouched. Only handles not already in the catalogue are added."}
          </span>
        </span>
      </label>
    </div>
  );
}

function PreviewStep({
  parsed,
  currency,
  fatal,
}: {
  parsed: ParseResult;
  currency: string;
  fatal: string | null;
}) {
  const sample = parsed.products.slice(0, 6);

  return (
    <div className="space-y-4">
      {fatal && <Callout tone="error">{fatal}</Callout>}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Products" value={parsed.stats.products} />
        <Stat label="Variants" value={parsed.stats.variants} />
        <Stat label="Images" value={parsed.stats.images} />
        <Stat label="Rows read" value={parsed.stats.rows} />
      </dl>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Product</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Variants</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
            </tr>
          </thead>
          <tbody>
            {sample.map((p) => (
              <tr key={p.handle} className="border-t">
                <td className="max-w-0 px-3 py-2">
                  <span className="block truncate font-medium">{p.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    /{p.handle}
                  </span>
                </td>
                <td className="px-3 py-2 capitalize text-muted-foreground">
                  {p.status}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {p.variants.length || "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(p.price, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {parsed.products.length > sample.length && (
          <p className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            and {(parsed.products.length - sample.length).toLocaleString()} more
          </p>
        )}
      </div>

      <IssueList
        tone="error"
        title="Rows that will be skipped"
        issues={parsed.errors}
      />
      <IssueList
        tone="warning"
        title="Imported with changes"
        issues={parsed.warnings}
      />

      {parsed.unknownColumns.length > 0 && (
        <Callout tone="muted">
          <span className="font-medium">
            {parsed.unknownColumns.length} column
            {parsed.unknownColumns.length === 1 ? "" : "s"} not imported:
          </span>{" "}
          {parsed.unknownColumns.join(", ")}. This store has no equivalent field
          for them.
        </Callout>
      )}

      <Callout tone="muted">
        Stock levels are not part of a Shopify product export, so imported
        products arrive with no quantities. Set them in Inventory afterwards.
      </Callout>
    </div>
  );
}

function ProgressStep({
  done,
  total,
  percent,
  totals,
}: {
  done: number;
  total: number;
  percent: number;
  totals: ImportTotals;
}) {
  return (
    <div className="space-y-4 py-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">
          {done.toLocaleString()} of {total.toLocaleString()} products
        </span>
        <span className="tabular-nums text-muted-foreground">{percent}%</span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {totals.created.toLocaleString()} created · {totals.updated.toLocaleString()}{" "}
        updated
        {totals.skipped > 0 && ` · ${totals.skipped.toLocaleString()} skipped`}
        {totals.failed > 0 && ` · ${totals.failed.toLocaleString()} failed`}
      </p>
    </div>
  );
}

function ResultStep({ totals }: { totals: ImportTotals }) {
  const clean = totals.failed === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        {clean ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-500" />
        ) : (
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
        )}
        <div>
          <p className="text-sm font-medium">
            {clean ? "Import complete" : "Import finished with errors"}
          </p>
          <p className="text-sm text-muted-foreground">
            {totals.created.toLocaleString()} created,{" "}
            {totals.updated.toLocaleString()} updated
            {totals.skipped > 0 && `, ${totals.skipped.toLocaleString()} skipped`}
            {totals.failed > 0 && `, ${totals.failed.toLocaleString()} failed`}.
          </p>
        </div>
      </div>

      <IssueList
        tone="error"
        title="Failed"
        issues={totals.errors.map((e) => ({ where: e.handle, message: e.message }))}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bits                                                                        */
/* -------------------------------------------------------------------------- */

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: "error" | "warning" | "muted";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-lg px-3 py-2 text-xs leading-relaxed",
        tone === "error" && "bg-destructive/10 text-destructive",
        tone === "warning" &&
          "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        tone === "muted" && "bg-muted text-muted-foreground"
      )}
    >
      {children}
    </p>
  );
}

/**
 * Issue lists are capped and scrollable. A malformed export can produce one
 * line per product, and 845 of them inside a dialog is not a report — it is a
 * wall. The first eight say what kind of problem it is; the count says how big.
 */
function IssueList({
  tone,
  title,
  issues,
}: {
  tone: "error" | "warning";
  title: string;
  issues: { where: string; message: string }[];
}) {
  if (!issues.length) return null;
  const shown = issues.slice(0, 8);

  return (
    <details className="rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium">
        {tone === "error" ? (
          <X className="size-3.5 text-destructive" />
        ) : (
          <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-500" />
        )}
        {title}
        <span className="text-muted-foreground">({issues.length})</span>
      </summary>
      <ul className="max-h-40 space-y-1 overflow-y-auto border-t px-3 py-2 text-xs">
        {shown.map((issue, i) => (
          <li key={`${issue.where}-${i}`} className="text-muted-foreground">
            <span className="font-medium text-foreground">{issue.where}</span>{" "}
            {issue.message}
          </li>
        ))}
        {issues.length > shown.length && (
          <li className="pt-1 text-muted-foreground">
            and {issues.length - shown.length} more
          </li>
        )}
      </ul>
    </details>
  );
}
