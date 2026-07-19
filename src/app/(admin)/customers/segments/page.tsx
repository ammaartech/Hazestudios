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
import { customerMatchesFilters } from "@/lib/segments";
import type { Customer, Segment } from "@/lib/types";
import { SegmentBuilder } from "./segment-builder";
import { SegmentDelete } from "./segment-delete";

export const metadata = { title: "Segments" };
export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  const supabase = await createClient();
  const [{ data: segmentsData }, { data: customersData }] = await Promise.all([
    supabase.from("segments").select("*").order("created_at"),
    supabase.from("customers").select("*"),
  ]);

  const segments = (segmentsData ?? []) as Segment[];
  const customers = (customersData ?? []) as Customer[];

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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
