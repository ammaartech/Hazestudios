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
    /*
      A segmented control is a single line by definition — five segments over
      two rows inside one rounded tray is not a segmented control, it is a grey
      blob, and that is what "All / Unfulfilled / Unpaid / Open" + "Closed" was
      on every phone-width list page.

      So it scrolls instead of wrapping, like the header's action row.

      Gutter zero, unlike that row: this strip must not bleed. The header's
      actions sit directly on the page and are meant to run to its edge, but
      these segments live inside a rounded tray that has to stay where it is —
      `p-1` is what keeps the first and last of them off the corners as they
      scroll past.
    */
    <div className="strip max-w-full gap-1 rounded-lg bg-muted p-1 [--strip-gutter:0px]">
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
              "rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors duration-150",
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
