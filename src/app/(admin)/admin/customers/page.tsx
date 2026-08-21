import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Pagination } from "@/components/admin/pagination";
import { SearchInput } from "@/components/admin/search-input";
import { DesktopTable, RecordList } from "@/components/admin/record-list";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import type { Customer } from "@/lib/types";

export const metadata = { title: "Customers" };

const PAGE_SIZE = 50;

/**
 * `default_address.country` holds a two-letter code, so joining it raw produced
 * "Siliguri, IN". Intl turns it into a name with no lookup table to maintain.
 */
const regionNames = new Intl.DisplayNames(["en"], {
  type: "region",
  fallback: "none",
});

function formatLocation(address: Record<string, string>) {
  const country = address.country
    ? // A malformed code would throw; the raw value is still better than nothing.
      (() => {
        try {
          return regionNames.of(address.country) ?? address.country;
        } catch {
          return address.country;
        }
      })()
    : null;
  return [address.city, address.province, country].filter(Boolean).join(", ");
}

/** PostgREST treats these as filter syntax, so they cannot reach a filter raw. */
function sanitize(term: string) {
  return term.replace(/[%,()*\\]/g, " ").trim();
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const supabase = await createClient();

  const page = Math.max(0, parseInt(pageParam ?? "0", 10) || 0);
  const term = sanitize(q ?? "");

  // `count: "exact"` is what makes the pager honest: without a total there is no
  // way to know a 3,952-row table is not the 1,000 rows PostgREST will return.
  let query = supabase
    .from("customers")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (term) {
    // Phone is searchable because a support call starts with a number far more
    // often than with a correctly spelled name.
    query = query.or(
      `first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`
    );
  }

  const { data, count } = await query;
  const customers = (data ?? []) as Customer[];
  const total = count ?? 0;

  return (
    <div>
      <PageHeader title="Customers">
        <Button asChild>
          <Link href="/admin/customers/new">Add customer</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground tabular-nums">
              {total.toLocaleString()} {total === 1 ? "customer" : "customers"}
              {term && " matching"}
            </p>
            <SearchInput placeholder="Search name, email or phone" />
          </div>

          {customers.length === 0 ? (
            <div className="py-16 text-center">
              {/* A fruitless search and an empty store need different next
                  steps, so they do not share a message. */}
              {term ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    No customers match “{q}”.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" asChild>
                    <Link href="/admin/customers">Clear search</Link>
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    No customers yet. They appear here after their first order.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" asChild>
                    <Link href="/admin/customers/new">Add customer</Link>
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              <RecordList
                items={customers.map((c) => {
                  const name = `${c.first_name} ${c.last_name}`.trim();
                  return {
                    id: c.id,
                    href: `/admin/customers/${c.id}`,
                    title: name || c.email || c.phone || "Unnamed customer",
                    // Falls back through the contact details, because an
                    // imported customer frequently has no name at all and a
                    // blank row is unusable.
                    subtitle:
                      (name && (c.email || c.phone)) ||
                      formatLocation(c.default_address) ||
                      null,
                    amount: formatMoney(c.total_spent),
                    badges: (
                      <span className="text-[12px] text-muted-foreground">
                        {c.orders_count} order{c.orders_count === 1 ? "" : "s"}
                      </span>
                    ),
                  };
                })}
              />

              <DesktopTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer name</TableHead>
                    <TableHead>Email subscription</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Amount spent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((c) => {
                    const name = `${c.first_name} ${c.last_name}`.trim();
                    const location = formatLocation(c.default_address);
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link
                            href={`/admin/customers/${c.id}`}
                            className="font-medium text-foreground transition-colors duration-150 hover:text-primary hover:underline"
                          >
                            {/* Imported records are frequently name-less; the
                                email is then the only handle there is. */}
                            {name || c.email || c.phone || "Unnamed customer"}
                          </Link>
                          {name && c.email && (
                            <span className="block text-xs text-muted-foreground">
                              {c.email}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {c.accepts_marketing ? (
                            <Badge
                              variant="secondary"
                              className="border-transparent bg-emerald-100 font-normal text-emerald-900"
                            >
                              Subscribed
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="font-normal">
                              Not subscribed
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {/* Distinguishes a self-service account from a guest or
                              imported record — it changes what support can tell
                              them to do (reset a password vs. create an account). */}
                          {c.user_id ? (
                            <Badge variant="secondary" className="font-normal">
                              Registered
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              Guest
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {location || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.orders_count}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(c.total_spent)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </DesktopTable>

              <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
