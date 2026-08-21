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
        {/* 20px — Shopify's page-title size. Was 22px, which the wider Work Sans
            pushed further still; with the UI face the smaller step holds the
            same hierarchy against 13px body copy. */}
        <h1 className="text-[1.25rem] font-semibold leading-tight tracking-[-0.012em] text-balance text-foreground">
          {title}
        </h1>
        {/* `flex-wrap` matters on a phone and nowhere else. Products carries
            four actions — Export, Import, Paste from Qikink, More actions —
            and on a 390px screen that row is about 520px wide, so without
            wrapping the last button ran off the right edge and was simply
            unreachable. */}
        {children && (
          <div className="flex flex-wrap items-center gap-2">{children}</div>
        )}
      </div>
    </div>
  );
}
