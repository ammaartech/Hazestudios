"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SearchInput({
  placeholder = "Search",
  className,
}: {
  placeholder?: string;
  /** Override the default `max-w-xs` container width (e.g. to fill the row). */
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function submit(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("q", value);
    else params.delete("q");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className={cn("relative w-full max-w-xs", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        defaultValue={searchParams.get("q") ?? ""}
        placeholder={placeholder}
        aria-label={placeholder}
        // h-7 to match the `size="sm"` buttons this sits between in every admin
        // filter bar; it was h-9, which left the input 8px taller than its
        // neighbours and read as a misalignment rather than a hierarchy.
        className="h-7 pl-8 glass-control"
        onKeyDown={(e) => {
          if (e.key === "Enter") submit((e.target as HTMLInputElement).value.trim());
        }}
      />
    </div>
  );
}
