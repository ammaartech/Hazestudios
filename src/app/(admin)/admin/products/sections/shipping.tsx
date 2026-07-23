"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useField } from "@/lib/form-store";
import type { WeightUnit } from "@/lib/types";
import { useProductStore } from "../product-draft";
import { Field } from "./fields";

const UNITS: WeightUnit[] = ["kg", "g", "lb", "oz"];

export function ShippingSection() {
  const store = useProductStore();
  const [requiresShipping] = useField(store, "requires_shipping");
  const [weight, setWeight] = useField(store, "weight");
  const [unit, setUnit] = useField(store, "weight_unit");
  const [country, setCountry] = useField(store, "country_of_origin");
  const [hsCode, setHsCode] = useField(store, "hs_code");

  return (
    <Card id="section-shipping" className="scroll-mt-32">
      <CardHeader>
        <CardTitle className="text-base">Shipping</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox
            checked={requiresShipping}
            onCheckedChange={(c) => store.set("requires_shipping", c === true)}
          />
          This is a physical product
        </label>

        {requiresShipping ? (
          <div className="space-y-4 border-t border-border pt-4">
            <Field
              label="Weight"
              hint="Used to calculate shipping rates at checkout."
              className="max-w-xs"
            >
              {(props) => (
                <div className="flex gap-2">
                  <Input
                    {...props}
                    inputMode="decimal"
                    placeholder="0.0"
                    className="tabular-nums"
                    value={weight}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === "" || /^\d*\.?\d{0,3}$/.test(next)) setWeight(next);
                    }}
                  />
                  <Select
                    value={unit}
                    onValueChange={(v) => setUnit(v as WeightUnit)}
                  >
                    <SelectTrigger aria-label="Weight unit" className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Country/region of origin"
                optional
                hint="Where the product was manufactured or assembled."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="e.g. Portugal"
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field
                label="HS (Harmonized System) code"
                optional
                hint="Used by customs to classify the shipment."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={hsCode}
                    onChange={(e) => setHsCode(e.target.value)}
                    placeholder="e.g. 6109.10"
                    className="font-mono"
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </Field>
            </div>
          </div>
        ) : (
          <p className="border-t border-border pt-4 text-xs text-muted-foreground">
            Digital products skip shipping rates and address collection at
            checkout.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
