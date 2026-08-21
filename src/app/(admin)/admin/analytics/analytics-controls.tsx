"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Check, ChevronDown, GitCompare } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, type RangeValue } from "@/lib/analytics/ranges";

function ControlButton({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-[13px] font-medium shadow-sm transition-colors duration-150 hover:bg-muted"
    >
      {icon}
      {children}
      <ChevronDown className="size-3.5 text-muted-foreground" />
    </button>
  );
}

/**
 * Date range and comparison controls. State lives in the URL so a filtered view
 * is shareable and survives a refresh, and so the server component can do the
 * aggregation rather than shipping raw orders to the client.
 */
export function AnalyticsControls({
  range,
  compare,
}: {
  range: RangeValue;
  compare: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.push(`/admin/analytics?${next.toString()}`, { scroll: false });
  }

  const activePreset =
    RANGE_PRESETS.find((p) => p.value === range) ?? RANGE_PRESETS[2];

  return (
    /* A strip, not a wrap. At 390px "Last 30 days" and "No comparison" are
       about 300px together and broke onto two lines, which pushed the "All
       reports" link beside them into a two-line block of its own hard against
       the right edge. */
    <div className="strip strip-flush-end min-w-0 flex-1 gap-2 [--strip-gutter:--spacing(4)] md:flex-none md:flex-wrap">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ControlButton icon={<Calendar className="size-3.5" />}>
            {activePreset.label}
          </ControlButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {RANGE_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.value}
              onClick={() => setParam("range", preset.value)}
              className="cursor-pointer"
            >
              <Check
                className={cn(
                  "size-4",
                  preset.value === range ? "opacity-100" : "opacity-0"
                )}
              />
              {preset.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ControlButton icon={<GitCompare className="size-3.5" />}>
            {compare ? "Previous period" : "No comparison"}
          </ControlButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem
            onClick={() => setParam("compare", null)}
            className="cursor-pointer"
          >
            <Check className={cn("size-4", compare ? "opacity-0" : "opacity-100")} />
            No comparison
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setParam("compare", "1")}
            className="cursor-pointer"
          >
            <Check className={cn("size-4", compare ? "opacity-100" : "opacity-0")} />
            Previous period
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
