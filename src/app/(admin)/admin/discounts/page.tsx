import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { FilterTabs } from "@/components/admin/filter-tabs";
import { DesktopTable } from "@/components/admin/record-list";
import { DiscountStatusBadge } from "@/components/admin/status-badges";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import type { Discount } from "@/lib/types";
import { DiscountDialog } from "./discount-dialog";
import { DiscountRowActions } from "./discount-row-actions";

export const metadata = { title: "Discounts" };
function describeDiscount(d: Discount) {
  switch (d.type) {
    case "percentage":
      return `${Number(d.value)}% off entire order`;
    case "fixed":
      return `${formatMoney(d.value)} off entire order`;
    case "free_shipping":
      return "Free shipping";
    case "bxgy":
      return "Buy X get Y";
  }
}

export default async function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("discounts")
    .select("*")
    .order("created_at", { ascending: false });
  if (status && ["active", "scheduled", "expired", "disabled"].includes(status)) {
    query = query.eq("status", status);
  }
  const { data } = await query;
  const discounts = (data ?? []) as Discount[];

  return (
    <div>
      <PageHeader title="Discounts" primary={<DiscountDialog />} />

      <Card>
        <CardContent className="pt-0">
          <div className="mb-3">
            <FilterTabs
              basePath="/admin/discounts"
              param="status"
              current={status}
              tabs={[
                { label: "All", value: undefined },
                { label: "Active", value: "active" },
                { label: "Scheduled", value: "scheduled" },
                { label: "Expired", value: "expired" },
                { label: "Disabled", value: "disabled" },
              ]}
            />
          </div>

          {discounts.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Create percentage, fixed-amount, or free-shipping discount codes.
            </p>
          ) : (
            <>
              {/*
                The phone shape. `RecordList` is the usual answer here and does
                not fit: it makes the whole row a link to a detail page, and a
                discount has no detail page — it is edited in a dialog opened
                from the row, so the row has to hold two live controls.

                Without this the seven-column table simply ran off the screen.
                It sits in a scroll container, so nothing was lost in the strict
                sense, but "Used", the active dates and both actions were past
                the right edge with no indication they existed — the page looked
                like it had been cut in half.
              */}
              <ul className="-mx-2 divide-y md:hidden">
                {discounts.map((d) => (
                  <li key={d.id} className="flex items-start gap-3 px-2 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold text-foreground">
                          {d.code}
                        </span>
                        <DiscountStatusBadge status={d.status} />
                      </div>
                      <p className="mt-1 text-[13px] text-foreground">
                        {describeDiscount(d)}
                        {d.min_purchase != null && (
                          <span className="block text-muted-foreground">
                            Min purchase {formatMoney(d.min_purchase)}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        <span className="tabular-nums">
                          {d.used_count}
                          {d.usage_limit ? ` / ${d.usage_limit}` : ""}
                        </span>
                        {" used · "}
                        {formatDate(d.starts_at)}
                        {d.ends_at ? ` – ${formatDate(d.ends_at)}` : " onward"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <DiscountDialog discount={d} />
                      <DiscountRowActions
                        id={d.id}
                        disabled={d.status === "disabled"}
                      />
                    </div>
                  </li>
                ))}
              </ul>

              <DesktopTable>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Used</TableHead>
                      <TableHead>Active dates</TableHead>
                      <TableHead className="w-40" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discounts.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono text-xs font-semibold">
                          {d.code}
                        </TableCell>
                        <TableCell>
                          <DiscountStatusBadge status={d.status} />
                        </TableCell>
                        <TableCell>
                          {describeDiscount(d)}
                          {d.min_purchase != null && (
                            <span className="block text-xs text-muted-foreground">
                              Min purchase {formatMoney(d.min_purchase)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {d.used_count}
                          {d.usage_limit ? ` / ${d.usage_limit}` : ""}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(d.starts_at)}
                          {d.ends_at ? ` – ${formatDate(d.ends_at)}` : " onward"}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <DiscountDialog discount={d} />
                            <DiscountRowActions
                              id={d.id}
                              disabled={d.status === "disabled"}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DesktopTable>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
