"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { parseQikinkPaste, type QikinkPasteResult } from "@/lib/qikink-paste";

/**
 * Handoff to `/admin/products/new`.
 *
 * sessionStorage rather than a query string or context: the payload is one
 * product's worth of options and SKUs, same-tab and one-shot, and the new
 * product page reads and immediately clears the key on mount (see
 * `use-qikink-paste.ts`) so a later, unrelated visit to that page never
 * resurrects it.
 */
export const QIKINK_PASTE_KEY = "hz:qikink-paste-draft";

type Phase = "paste" | "preview";

export function PasteQikinkDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("paste");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<QikinkPasteResult | null>(null);

  const reset = useCallback(() => {
    setPhase("paste");
    setText("");
    setParsed(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [reset, onOpenChange]
  );

  const handlePreview = useCallback(() => {
    const result = parseQikinkPaste(text);
    setParsed(result);
    if (result.variants.length) setPhase("preview");
  }, [text]);

  const handleCreate = useCallback(() => {
    if (!parsed?.variants.length) return;
    sessionStorage.setItem(QIKINK_PASTE_KEY, JSON.stringify(parsed));
    handleOpenChange(false);
    router.push("/admin/products/new");
  }, [parsed, handleOpenChange, router]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Paste from Qikink</DialogTitle>
          <DialogDescription>
            In Qikink, open My Products → a product → view details, select the
            whole Product Variations table and copy it. Paste it below.
          </DialogDescription>
        </DialogHeader>

        {phase === "paste" && (
          <div className="space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Name	Variation	Product SKU	Design SKU	Store SKU	Image	Product Cost	Selling Cost&#10;Unisex Acid Washed Oversized Tee	Black - S	UAOsMrnhs-Bk-S	…"
              rows={10}
              className={cn(
                "w-full min-w-0 rounded-lg border border-input bg-transparent p-2.5 font-mono text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              )}
            />
            {parsed && !parsed.variants.length && (
              <Callout tone="error">
                {parsed.errors[0] ?? "Nothing usable found in that paste."}
              </Callout>
            )}
          </div>
        )}

        {phase === "preview" && parsed && (
          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-3">
              <Stat label="Title" value={parsed.title || "(none found)"} />
              <Stat
                label="Options"
                value={parsed.options.map((o) => o.values.length).join(" × ") || "—"}
              />
              <Stat label="Variants" value={String(parsed.variants.length)} />
            </dl>

            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Variant</th>
                    <th className="px-3 py-2 text-left font-medium">Store SKU</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.variants.slice(0, 8).map((v) => (
                    <tr key={v.title} className="border-t">
                      <td className="px-3 py-2">{v.title}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {v.sku}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.variants.length > 8 && (
                <p className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  and {parsed.variants.length - 8} more
                </p>
              )}
            </div>

            <IssueList issues={parsed.errors} />

            <Callout tone="muted">
              Only the title and variant SKUs are filled in. Price, media, tags
              and everything else are left for you to add on the next page.
            </Callout>
          </div>
        )}

        <DialogFooter>
          {phase === "paste" && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handlePreview} disabled={!text.trim()}>
                Preview
              </Button>
            </>
          )}
          {phase === "preview" && (
            <>
              <Button variant="outline" onClick={() => setPhase("paste")}>
                Back
              </Button>
              <Button onClick={handleCreate}>
                Create product with {parsed?.variants.length ?? 0} variant
                {parsed?.variants.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold" title={value}>
        {value}
      </dd>
    </div>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: "error" | "muted";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-lg px-3 py-2 text-xs leading-relaxed",
        tone === "error" && "bg-destructive/10 text-destructive",
        tone === "muted" && "bg-muted text-muted-foreground"
      )}
    >
      {children}
    </p>
  );
}

function IssueList({ issues }: { issues: string[] }) {
  if (!issues.length) return null;
  const shown = issues.slice(0, 8);

  return (
    <details className="rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium">
        <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-500" />
        Rows skipped
        <span className="text-muted-foreground">({issues.length})</span>
      </summary>
      <ul className="max-h-40 space-y-1 overflow-y-auto border-t px-3 py-2 text-xs text-muted-foreground">
        {shown.map((issue, i) => (
          <li key={i}>{issue}</li>
        ))}
        {issues.length > shown.length && (
          <li className="pt-1">and {issues.length - shown.length} more</li>
        )}
      </ul>
    </details>
  );
}

