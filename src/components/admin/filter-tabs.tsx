import Link from "next/link";
import { cn } from "@/lib/utils";

export function FilterTabs({
  basePath,
  param,
  current,
  tabs,
}: {
  basePath: string;
  param: string;
  current: string | undefined;
  tabs: { label: string; value: string | undefined }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
      {tabs.map((tab) => {
        const active = (current ?? undefined) === tab.value;
        const href = tab.value
          ? `${basePath}?${param}=${encodeURIComponent(tab.value)}`
          : basePath;
        return (
          <Link
            key={tab.label}
            href={href}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors duration-150",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
