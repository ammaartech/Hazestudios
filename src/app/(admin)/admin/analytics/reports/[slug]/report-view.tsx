"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CUSTOM_RANGE, RANGE_PRESETS } from "@/lib/analytics/ranges";
import { recordReportView } from "../report-catalog";
import { cn } from "@/lib/utils";

/**
 * Stamps the catalog's "Last viewed" column. Split out as its own component so
 * the report page itself stays a server component.
 */
export function RecordView({ slug }: { slug: string }) {
  useEffect(() => recordReportView(slug), [slug]);
  return null;
}

/** Today as `YYYY-MM-DD`, so the pickers cannot reach into the future. */
function todayValue() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function ReportRangeControls({
  range,
  label,
  from,
  to,
}: {
  range: string;
  /** Resolved server-side, so a custom window reads as its actual dates. */
  label: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const isCustom = range === CUSTOM_RANGE;
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(isCustom);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  const today = todayValue();

  function push(next: URLSearchParams) {
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function selectPreset(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set("range", value);
    // Stale from/to would otherwise sit in the URL contradicting the preset.
    next.delete("from");
    next.delete("to");
    push(next);
    setShowCustom(false);
    setOpen(false);
  }

  function applyCustom() {
    if (!draftFrom || !draftTo) return;
    const next = new URLSearchParams(params.toString());
    next.set("range", CUSTOM_RANGE);
    next.set("from", draftFrom);
    next.set("to", draftTo);
    push(next);
    setOpen(false);
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reopening should show the panel matching what is actually applied.
        if (!next) setShowCustom(isCustom);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-[13px] font-medium shadow-sm transition-colors duration-150 hover:bg-muted"
        >
          <Calendar className="size-3.5" />
          {label}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {RANGE_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.value}
            onClick={() => selectPreset(preset.value)}
            className="cursor-pointer"
          >
            <Check
              className={cn(
                "size-4",
                !isCustom && preset.value === range
                  ? "opacity-100"
                  : "opacity-0"
              )}
            />
            {preset.label}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          // Kept open: this row reveals the pickers rather than applying a
          // range, and the menu closing on select would hide them instantly.
          onSelect={(e) => {
            e.preventDefault();
            setShowCustom((prev) => !prev);
          }}
          className="cursor-pointer"
        >
          <Check className={cn("size-4", isCustom ? "opacity-100" : "opacity-0")} />
          Custom range
        </DropdownMenuItem>

        {showCustom && (
          <div className="space-y-2 border-t px-2 pb-1 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">From</span>
                <input
                  type="date"
                  value={draftFrom}
                  max={draftTo || today}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">To</span>
                <input
                  type="date"
                  value={draftTo}
                  min={draftFrom || undefined}
                  max={today}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!draftFrom || !draftTo}
              className="h-8 w-full cursor-pointer rounded-md bg-primary text-xs font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
