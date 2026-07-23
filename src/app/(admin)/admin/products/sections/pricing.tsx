"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFields } from "@/lib/form-store";
import { currencySymbol, formatMoney } from "@/lib/format";
import { toNumber } from "@/lib/number-input";
import { useProductStore, type ProductDraft } from "../product-draft";
import { Field, MoneyInput } from "./fields";

const KEYS = ["price", "compare_at_price", "cost_per_item"] as const;

export function PricingSection({ currency = "USD" }: { currency?: string }) {
  const store = useProductStore();
  const values = useFields<ProductDraft, (typeof KEYS)[number]>(store, KEYS);
  const symbol = currencySymbol(currency);

  const price = toNumber(values.price);
  const compareAt = toNumber(values.compare_at_price);
  const cost = toNumber(values.cost_per_item);

  const profit = price != null && cost != null ? price - cost : null;
  const margin =
    profit != null && price != null && price > 0
      ? Math.round((profit / price) * 1000) / 10
      : null;

  // Shopify shows compare-at as the struck-through "was" price, so a value at
  // or below the selling price would render as a discount of zero or less.
  const compareAtInvalid =
    compareAt != null && price != null && compareAt <= price
      ? "Compare-at price should be higher than the price to show as a markdown."
      : undefined;

  return (
    <Card id="section-pricing" className="scroll-mt-32">
      <CardHeader>
        <CardTitle className="text-base">Pricing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price">
            {(props) => (
              <MoneyInput
                {...props}
                symbol={symbol}
                value={values.price}
                onChange={(v) => store.set("price", v)}
              />
            )}
          </Field>

          <Field
            label="Compare-at price"
            optional
            error={compareAtInvalid}
            hint="Shown struck through next to the price."
          >
            {(props) => (
              <MoneyInput
                {...props}
                symbol={symbol}
                value={values.compare_at_price}
                onChange={(v) => store.set("compare_at_price", v)}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Cost per item"
            optional
            hint="Never shown to customers."
          >
            {(props) => (
              <MoneyInput
                {...props}
                symbol={symbol}
                value={values.cost_per_item}
                onChange={(v) => store.set("cost_per_item", v)}
              />
            )}
          </Field>

          {/* Derived, so it is presented as read-out rather than as two more
              empty-looking inputs the operator might try to fill in. */}
          <dl className="grid grid-cols-2 items-end gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Profit</dt>
              <dd className="mt-1 h-8 leading-8 font-medium tabular-nums">
                {profit != null ? formatMoney(profit, currency) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Margin</dt>
              <dd className="mt-1 h-8 leading-8 font-medium tabular-nums">
                {margin != null ? `${margin}%` : "—"}
              </dd>
            </div>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
