"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PackageDefaults, PickupAddress } from "@/lib/couriers/draft";
import { saveShippingProfile } from "./actions";

/**
 * The store's shipping profile: the address couriers collect from, the
 * address a failed delivery comes back to, and what a typical parcel weighs.
 *
 * Every field here is something both couriers refuse a booking without, which
 * is why the pincode and phone are validated on save and not merely stored —
 * a profile that saves but cannot ship would surface as a failed booking at
 * the worst possible moment.
 */

type AddressFields = Record<AddressKey, string>;
type AddressKey = "name" | "company" | "phone" | "email" | "address1" | "address2" | "landmark" | "city" | "state" | "postal_code" | "gst_number";

const EMPTY: AddressFields = {
  name: "", company: "", phone: "", email: "", address1: "", address2: "", landmark: "",
  city: "", state: "", postal_code: "", gst_number: "",
};

function fromAddress(a: PickupAddress | null): AddressFields {
  if (!a) return EMPTY;
  return {
    name: a.name, company: a.company, phone: a.phone, email: a.email, address1: a.address1, address2: a.address2,
    landmark: a.landmark, city: a.city, state: a.state, postal_code: a.postal_code, gst_number: a.gst_number,
  };
}

export function PickupForm({
  pickup,
  returnAddress,
  packageDefaults,
}: {
  pickup: PickupAddress | null;
  returnAddress: PickupAddress | null;
  packageDefaults: PackageDefaults;
}) {
  const [pending, startTransition] = useTransition();
  const [from, setFrom] = useState<AddressFields>(fromAddress(pickup));
  const [sameReturn, setSameReturn] = useState(!returnAddress);
  const [back, setBack] = useState<AddressFields>(fromAddress(returnAddress));
  const [pkg, setPkg] = useState({
    weight_kg: String(packageDefaults.weight_kg),
    length_cm: String(packageDefaults.length_cm),
    width_cm: String(packageDefaults.width_cm),
    height_cm: String(packageDefaults.height_cm),
  });

  function handleSave() {
    startTransition(async () => {
      const result = await saveShippingProfile({ pickup: from, returnAddress: back, sameReturn, packageDefaults: pkg });
      if (result.ok) toast.success(result.message ?? "Saved");
      else toast.error(result.error);
    });
  }

  return (
    <Card id="pickup">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Pickup address and parcel defaults</CardTitle>
        <Badge variant={pickup ? "default" : "secondary"}>{pickup ? "Set" : "Not set"}</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Where couriers collect parcels and where undelivered ones come back to. Every booking made from an order&rsquo;s{" "}
          <span className="font-medium text-foreground">Ship now</span> button uses this — get it right once and never type it again.
        </p>

        <AddressFieldset prefix="pickup" legend="Pickup address" value={from} onChange={setFrom} />

        <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="same-return">Returns come back to the pickup address</Label>
            <p className="text-xs text-muted-foreground">Switch off to give the couriers a different return (RTO) address.</p>
          </div>
          <Switch id="same-return" checked={sameReturn} onCheckedChange={setSameReturn} />
        </div>

        {!sameReturn && <AddressFieldset prefix="return" legend="Return address" value={back} onChange={setBack} />}

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Typical parcel</legend>
          <p className="text-xs text-muted-foreground">
            Pre-fills the Ship now dialog. Weight in kilograms, dimensions in centimetres; couriers bill on the higher of actual and
            volumetric (L × W × H ÷ 5000) weight.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField id="pkg-weight" label="Weight (kg)" step="0.05" value={pkg.weight_kg} onChange={(v) => setPkg({ ...pkg, weight_kg: v })} />
            <NumberField id="pkg-length" label="Length (cm)" value={pkg.length_cm} onChange={(v) => setPkg({ ...pkg, length_cm: v })} />
            <NumberField id="pkg-width" label="Width (cm)" value={pkg.width_cm} onChange={(v) => setPkg({ ...pkg, width_cm: v })} />
            <NumberField id="pkg-height" label="Height (cm)" value={pkg.height_cm} onChange={(v) => setPkg({ ...pkg, height_cm: v })} />
          </div>
        </fieldset>

        <Button onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

function AddressFieldset({
  prefix,
  legend,
  value,
  onChange,
}: {
  prefix: string;
  legend: string;
  value: AddressFields;
  onChange: (next: AddressFields) => void;
}) {
  const set = (key: AddressKey) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value });
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${prefix}-name`} label="Contact name" value={value.name} onChange={set("name")} autoComplete="name" />
        <Field id={`${prefix}-company`} label="Company (on the label)" value={value.company} onChange={set("company")} autoComplete="organization" />
        <Field id={`${prefix}-phone`} label="Mobile" value={value.phone} onChange={set("phone")} inputMode="tel" placeholder="10 digits" hint="The number the courier calls at pickup." />
        <Field id={`${prefix}-email`} label="Email" type="email" value={value.email} onChange={set("email")} autoComplete="email" />
        <div className="sm:col-span-2">
          <Field id={`${prefix}-address1`} label="Address" value={value.address1} onChange={set("address1")} autoComplete="address-line1" />
        </div>
        <Field id={`${prefix}-address2`} label="Apartment, floor, building" value={value.address2} onChange={set("address2")} autoComplete="address-line2" />
        <Field id={`${prefix}-landmark`} label="Landmark" value={value.landmark} onChange={set("landmark")} />
        <Field id={`${prefix}-city`} label="City" value={value.city} onChange={set("city")} autoComplete="address-level2" />
        <Field id={`${prefix}-state`} label="State" value={value.state} onChange={set("state")} autoComplete="address-level1" placeholder="Maharashtra" hint="Spelled out — couriers match on the name." />
        <Field id={`${prefix}-pincode`} label="Pincode" value={value.postal_code} onChange={set("postal_code")} inputMode="numeric" maxLength={6} autoComplete="postal-code" />
        <Field id={`${prefix}-gst`} label="GSTIN (optional)" value={value.gst_number} onChange={set("gst_number")} hint="Printed on labels and invoices where the courier supports it." />
      </div>
    </fieldset>
  );
}

function Field({
  id,
  label,
  hint,
  ...props
}: { id: string; label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  step = "1",
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  step?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="decimal" min="0" step={step} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
