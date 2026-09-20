"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightLeft,
  Calendar,
  Check,
  ChevronDown,
  GitCompare,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { currencySymbol } from "@/lib/format";
import {
  COMPARE_MODES,
  CUSTOM_RANGE,
  RANGE_PRESETS,
  type CompareMode,
} from "@/lib/analytics/ranges";

/**
 * The pill every control on the dashboard wears — small, bordered, one icon
 * on the left and (for menus) a chevron on the right.
 */
function Pill({
  icon,
  children,
  chevron = true,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ReactNode;
  chevron?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[13px] font-medium whitespace-nowrap shadow-xs transition-colors duration-150 hover:bg-muted disabled:cursor-default disabled:hover:bg-card",
        className
      )}
      {...props}
    >
      <span className="text-muted-foreground">{icon}</span>
      {children}
      {chevron && <ChevronDown className="size-3.5 text-muted-foreground" />}
    </button>
  );
}

/** Today as `YYYY-MM-DD`, so the pickers cannot reach into the future. */
function todayValue() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const inputClass =
  "h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25";

/**
 * Date range, comparison and currency controls. State lives in the URL so a
 * filtered view is shareable and survives a refresh, and so the server
 * component can do the aggregation rather than shipping raw orders down.
 */
export function AnalyticsControls({
  range,
  rangeLabel,
  from,
  to,
  compare,
  currency,
}: {
  range: string;
  /** Resolved server-side: a preset's name, or a custom window's dates. */
  rangeLabel: string;
  /** Current window as `YYYY-MM-DD`, seeding the custom pickers. */
  from: string;
  to: string;
  compare: CompareMode;
  currency: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const isCustom = range === CUSTOM_RANGE;
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(isCustom);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const today = todayValue();

  function push(next: URLSearchParams) {
    router.push(`/admin/analytics?${next.toString()}`, { scroll: false });
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

  function selectCompare(mode: CompareMode) {
    const next = new URLSearchParams(params.toString());
    if (mode === "none") next.delete("compare");
    else next.set("compare", mode);
    push(next);
  }

  const compareLabel =
    COMPARE_MODES.find((m) => m.value === compare)?.label ?? "No comparison";

  return (
    /* A strip, not a wrap: three pills side by side scroll on a phone rather
       than stacking into a column of buttons. */
    <div className="strip min-w-0 gap-2 [--strip-gutter:--spacing(4)] md:[--strip-gutter:--spacing(8)] xl:[--strip-gutter:--spacing(12)]">
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Reopening should show the panel matching what is actually applied.
          if (!next) setShowCustom(isCustom);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Pill icon={<Calendar className="size-3.5" />}>{rangeLabel}</Pill>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {/* Two columns keeps thirteen presets above the fold of the menu. */}
          <div className="grid grid-cols-2 gap-x-1">
            {RANGE_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.value}
                onClick={() => selectPreset(preset.value)}
                className="cursor-pointer gap-1.5 px-1.5 text-[13px]"
              >
                <Check
                  className={cn(
                    "size-3.5 shrink-0",
                    !isCustom && preset.value === range
                      ? "opacity-100"
                      : "opacity-0"
                  )}
                />
                {preset.label}
              </DropdownMenuItem>
            ))}
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            // Kept open: this row reveals the pickers rather than applying a
            // range, and the menu closing on select would hide them instantly.
            onSelect={(e) => {
              e.preventDefault();
              setShowCustom((prev) => !prev);
            }}
            className="cursor-pointer gap-1.5 px-1.5 text-[13px]"
          >
            <Check
              className={cn("size-3.5", isCustom ? "opacity-100" : "opacity-0")}
            />
            Custom
          </DropdownMenuItem>

          {showCustom && (
            <div className="space-y-2 border-t px-1.5 pt-2 pb-1">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Start</span>
                  <input
                    type="date"
                    value={draftFrom}
                    max={draftTo || today}
                    onChange={(e) => setDraftFrom(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">End</span>
                  <input
                    type="date"
                    value={draftTo}
                    min={draftFrom || undefined}
                    max={today}
                    onChange={(e) => setDraftTo(e.target.value)}
                    className={inputClass}
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Pill icon={<GitCompare className="size-3.5" />}>{compareLabel}</Pill>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {COMPARE_MODES.map((mode) => (
            <DropdownMenuItem
              key={mode.value}
              onClick={() => selectCompare(mode.value)}
              className="cursor-pointer text-[13px]"
            >
              <Check
                className={cn(
                  "size-3.5",
                  mode.value === compare ? "opacity-100" : "opacity-0"
                )}
              />
              {mode.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Reporting currency. One currency on this store, so the pill states it
          rather than offering a conversion menu it cannot honour. */}
      <Pill
        icon={<ArrowRightLeft className="size-3.5" />}
        chevron={false}
        disabled
        aria-label={`Reporting currency ${currency}`}
      >
        {currency} {currencySymbol(currency)}
      </Pill>
    </div>
  );
}

/**
 * "Last refreshed: 12:27 pm" — the moment this render happened, in the
 * viewer's own clock. The server's timezone is not the admin's, so the server
 * snapshot is a placeholder and the real time is read only on the client;
 * `useSyncExternalStore` is how React renders a client-only value without a
 * hydration mismatch or a state update inside an effect.
 */
const subscribeToNothing = () => () => {};

export function LastRefreshed({ at }: { at: string }) {
  const text = useSyncExternalStore(
    subscribeToNothing,
    () =>
      new Date(at).toLocaleTimeString("en-IN", {
        hour: "numeric",
        minute: "2-digit",
      }),
    () => null
  );

  return (
    <span className="text-[13px] text-muted-foreground">
      Last refreshed:{" "}
      <span className="inline-block min-w-14 tabular-nums">{text ?? "…"}</span>
    </span>
  );
}

/** The header's overflow menu: the rest of the analytics section. */
export function AnalyticsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More"
          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border bg-card shadow-xs transition-colors duration-150 hover:bg-muted"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild className="cursor-pointer text-[13px]">
          <Link href="/admin/analytics/live">Live View</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer text-[13px]">
          <Link href="/admin/analytics/reports">Reports</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
