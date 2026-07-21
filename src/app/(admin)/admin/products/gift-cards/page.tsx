import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { formatDate, formatMoney } from "@/lib/format";
import type { Customer, GiftCard } from "@/lib/types";
import { GiftCardDialog } from "./gift-card-dialog";
import { GiftCardToggle } from "./gift-card-toggle";

export const metadata = { title: "Gift cards" };
export const dynamic = "force-dynamic";

type GiftCardRow = GiftCard & {
  customers: Pick<Customer, "first_name" | "last_name" | "email"> | null;
};

export default async function GiftCardsPage() {
  const supabase = await createClient();
  const [{ data: cardsData }, { data: customersData }] = await Promise.all([
    supabase
      .from("gift_cards")
      .select("*, customers(first_name, last_name, email)")
      .order("created_at", { ascending: false }),
    supabase
      .from("customers")
      .select("id, first_name, last_name, email")
      .order("first_name"),
  ]);

  const cards = (cardsData ?? []) as GiftCardRow[];

  return (
    <div>
      <PageHeader title="Gift cards">
        <GiftCardDialog customers={customersData ?? []} />
      </PageHeader>

      <Card>
        <CardContent className="pt-0">
          {cards.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Issue digital gift cards or voucher credits to customers.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.map((card) => {
                  const expired =
                    card.expires_at && new Date(card.expires_at) < new Date();
                  const status = card.disabled_at
                    ? { label: "Disabled", variant: "secondary" as const }
                    : expired
                      ? { label: "Expired", variant: "secondary" as const }
                      : { label: "Active", variant: "default" as const };
                  const customerName = card.customers
                    ? `${card.customers.first_name} ${card.customers.last_name}`.trim() ||
                      card.customers.email
                    : "—";
                  return (
                    <TableRow key={card.id}>
                      <TableCell className="font-mono text-xs">{card.code}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell>{customerName}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatMoney(card.balance)} / {formatMoney(card.initial_value)}
                      </TableCell>
                      <TableCell>{formatDate(card.created_at)}</TableCell>
                      <TableCell>
                        {card.expires_at ? formatDate(card.expires_at) : "Never"}
                      </TableCell>
                      <TableCell>
                        <GiftCardToggle id={card.id} disabled={Boolean(card.disabled_at)} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
