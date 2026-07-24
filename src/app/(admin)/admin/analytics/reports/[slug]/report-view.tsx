"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RANGE_PRESETS } from "@/lib/analytics/ranges";
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

export function ReportRangeControls({ range }: { range: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const active = RANGE_PRESETS.find((p) => p.value === range) ?? RANGE_PRESETS[2];

  function select(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set("range", value);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-[13px] font-medium shadow-sm transition-colors duration-150 hover:bg-muted"
        >
          <Calendar className="size-3.5" />
          {active.label}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {RANGE_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.value}
            onClick={() => select(preset.value)}
            className="cursor-pointer"
          >
            <Check
              className={cn(
                "size-4",
                preset.value === active.value ? "opacity-100" : "opacity-0"
              )}
            />
            {preset.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
