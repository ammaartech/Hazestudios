import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function PageHeader({
  title,
  backHref,
  backLabel,
  children,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      {backHref && (
        <Link
          href={backHref}
          className="mb-1.5 -ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {backLabel ?? "Back"}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.012em] text-balance text-foreground">
          {title}
        </h1>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}
