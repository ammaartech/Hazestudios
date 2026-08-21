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
import { createClient } from "@/lib/supabase/server";
import {
  customerMatchesFilters,
  type MatchableCustomer,
} from "@/lib/segments";
import type { Segment } from "@/lib/types";
import { DesktopTable } from "@/components/admin/record-list";
import { SegmentBuilder } from "./segment-builder";
import { SegmentDelete } from "./segment-delete";

export const metadata = { title: "Segments" };
export default async function SegmentsPage() {
  const supabase = await createClient();
  const [{ data: segmentsData }, { data: customersData }] = await Promise.all([
    supabase.from("segments").select("*").order("created_at"),
    // Counting matches only needs the fields the filters read, not full rows.
    supabase
      .from("customers")
      .select("total_spent, orders_count, default_address, accepts_marketing, tags"),
  ]);

  const segments = (segmentsData ?? []) as Segment[];
  const customers = (customersData ?? []) as MatchableCustomer[];

  return (
    <div>
      <PageHeader title="Segments">
        <SegmentBuilder />
      </PageHeader>

      <Card>
        <CardContent className="pt-0">
          {segments.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Group customers with filters like amount spent, orders, location,
              or tags.
            </p>
          ) : (
            <>
              {/* The filter description is the widest thing on the row and the
                  two controls are the most important, so on a phone the
                  description gets its own line and the controls keep the top
                  right corner. */}
              <ul className="-mx-2 divide-y md:hidden">
                {segments.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-start justify-between gap-3 px-2 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium text-foreground">
                        {s.name}
                      </p>
                      <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
                        {
                          customers.filter((c) =>
                            customerMatchesFilters(c, s.filters)
                          ).length
                        }{" "}
                        customers
                      </p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {s.filters.length
                          ? s.filters
                              .map(
                                (f) =>
                                  `${f.field.replace(/_/g, " ")} ${f.operator.replace(/_/g, " ")} ${f.value}`
                              )
                              .join(" · ")
                          : "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <SegmentBuilder segment={s} />
                      <SegmentDelete id={s.id} />
                    </div>
                  </li>
                ))}
              </ul>

              <DesktopTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Segment</TableHead>
                  <TableHead>Filters</TableHead>
                  <TableHead>Customers</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {segments.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.filters.length
                        ? s.filters
                            .map(
                              (f) =>
                                `${f.field.replace(/_/g, " ")} ${f.operator.replace(/_/g, " ")} ${f.value}`
                            )
                            .join(" · ")
                        : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {customers.filter((c) => customerMatchesFilters(c, s.filters)).length}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <SegmentBuilder segment={s} />
                        <SegmentDelete id={s.id} />
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
