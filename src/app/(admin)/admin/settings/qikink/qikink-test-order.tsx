"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sendQikinkTestOrder, type TestOrderInput } from "./actions";

/** Qikink's print_type_id values, from the API reference. */
const PRINT_TYPES = [
  { id: "1", label: "DTG" },
  { id: "17", label: "DTF" },
  { id: "2", label: "All Over Print" },
  { id: "3", label: "Embroidery" },
  { id: "5", label: "Accessories" },
  { id: "6", label: "Puff Print" },
  { id: "7", label: "Glow-In-Dark" },
  { id: "12", label: "Rainbow Vinyl" },
  { id: "13", label: "Gold Vinyl" },
  { id: "14", label: "Silver Vinyl" },
  { id: "15", label: "Reflective Grey Vinyl" },
];

const PLACEMENTS = [
  { sku: "fr", label: "Front" },
  { sku: "bk", label: "Back" },
  { sku: "lp", label: "Left Pocket" },
  { sku: "rp", label: "Right Pocket" },
  { sku: "ls", label: "Left Shoulder" },
  { sku: "rs", label: "Right Shoulder" },
];

const INITIAL: TestOrderInput = {
  mode: "catalogue",
  // A real Classic Crew SKU from the catalogue, so the field works as an example.
  sku: "MRnHs-Bk-M",
  printTypeId: "1",
  designCode: "",
  designUrl: "",
  mockupUrl: "",
  placementSku: "fr",
  widthInches: "8",
  heightInches: "10",
  firstName: "Test",
  lastName: "Order",
  address1: "1 Test Street",
  address2: "",
  city: "Coimbatore",
  province: "Tamil Nadu",
  zip: "641001",
  phone: "9999999999",
  email: "test@example.com",
  countryCode: "IN",
};

/**
 * Sends a single order straight to Qikink.
 *
 * The two modes exist because Qikink keeps two SKU lists and they are not
 * interchangeable: a SKU Descriptions code is a blank garment and has to carry
 * a design, while a My Products code already knows its own artwork.
 */
export function QikinkTestOrder({ environment }: { environment: "sandbox" | "live" }) {
  const [form, setForm] = useState<TestOrderInput>(INITIAL);
  const [sent, setSent] = useState<{
    orderNumber: string;
    qikinkOrderId: string;
    remoteStatus: string | null;
    host: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof TestOrderInput>(key: K, value: TestOrderInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const catalogue = form.mode === "catalogue";

  function handleSend() {
    startTransition(async () => {
      const result = await sendQikinkTestOrder(form);
      if (result.ok) {
        toast.success(result.message ?? "Sent");
        setSent({
          orderNumber: result.orderNumber ?? "",
          qikinkOrderId: result.qikinkOrderId ?? "",
          remoteStatus: result.remoteStatus ?? null,
          host: result.host ?? "",
        });
      } else {
        setSent(null);
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Send a test order</CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {environment === "live" && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            You are on <strong>live</strong>. An order sent from here will really
            be printed and shipped, and you will be charged for it. Switch to
            sandbox to test for free.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="test-mode">SKU source</Label>
            <Select
              value={form.mode}
              onValueChange={(v) => set("mode", v as TestOrderInput["mode"])}
            >
              <SelectTrigger id="test-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="catalogue">SKU Descriptions — blank garment</SelectItem>
                <SelectItem value="my_products">My Products — already designed</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {catalogue
                ? "A Product SKU from sku_descriptions — a blank garment, so it needs a design, but it works without building anything in Qikink first."
                : "The Store SKU from My Products → Product Variations. Qikink already knows the garment and artwork, so no design is needed."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="test-sku">SKU</Label>
            <Input
              id="test-sku"
              value={form.sku}
              onChange={(e) => set("sku", e.target.value)}
              placeholder={catalogue ? "MRnHs-Bk-M" : "v-8RCp0i6ad1dU18MNNRc0pbbepQ3b9XQ="}
            />
          </div>
        </div>

        {catalogue && (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="test-print-type">Print type</Label>
                <Select
                  value={form.printTypeId}
                  onValueChange={(v) => set("printTypeId", v)}
                >
                  <SelectTrigger id="test-print-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRINT_TYPES.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="test-placement">Placement</Label>
                <Select
                  value={form.placementSku}
                  onValueChange={(v) => set("placementSku", v)}
                >
                  <SelectTrigger id="test-placement">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLACEMENTS.map((p) => (
                      <SelectItem key={p.sku} value={p.sku}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="test-design-url">Design URL</Label>
              <Input
                id="test-design-url"
                value={form.designUrl}
                onChange={(e) => set("designUrl", e.target.value)}
                placeholder="https://…/artwork.png"
              />
              <p className="text-xs text-muted-foreground">
                Must be publicly reachable — Qikink downloads it from their side,
                so a localhost or signed-expiring URL will fail.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="test-mockup-url">Mockup URL</Label>
              <Input
                id="test-mockup-url"
                value={form.mockupUrl}
                onChange={(e) => set("mockupUrl", e.target.value)}
                placeholder="Optional — the design is used if left blank"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="test-design-code">Design code</Label>
                <Input
                  id="test-design-code"
                  value={form.designCode}
                  onChange={(e) => set("designCode", e.target.value)}
                  placeholder="Auto"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="test-width">Width (in)</Label>
                <Input
                  id="test-width"
                  value={form.widthInches}
                  onChange={(e) => set("widthInches", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="test-height">Height (in)</Label>
                <Input
                  id="test-height"
                  value={form.heightInches}
                  onChange={(e) => set("heightInches", e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4 rounded-lg border p-4">
          <p className="text-sm font-medium">Ship to</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="test-first-name" label="First name" value={form.firstName} onChange={(v) => set("firstName", v)} />
            <Field id="test-last-name" label="Last name" value={form.lastName} onChange={(v) => set("lastName", v)} />
            <Field id="test-address" label="Address" value={form.address1} onChange={(v) => set("address1", v)} />
            <Field id="test-address2" label="Address line 2" value={form.address2} onChange={(v) => set("address2", v)} />
            <Field id="test-city" label="City" value={form.city} onChange={(v) => set("city", v)} />
            <Field id="test-phone" label="Phone" value={form.phone} onChange={(v) => set("phone", v)} />
            <Field
              id="test-province"
              label="State"
              value={form.province}
              onChange={(v) => set("province", v)}
              hint="Full state name, spelled exactly — Qikink matches on the name, not a code."
            />
            <Field id="test-zip" label="Postcode" value={form.zip} onChange={(v) => set("zip", v)} />
            <Field id="test-email" label="Email" value={form.email} onChange={(v) => set("email", v)} />
            <Field id="test-country" label="Country code" value={form.countryCode} onChange={(v) => set("countryCode", v)} />
          </div>
        </div>

        {sent && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              {sent.remoteStatus
                ? "Order created and confirmed"
                : "Qikink accepted the order"}
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-muted-foreground">
              <dt>Our reference</dt>
              <dd className="font-mono text-xs">{sent.orderNumber}</dd>
              {sent.qikinkOrderId && (
                <>
                  <dt>Qikink order id</dt>
                  <dd className="font-mono text-xs">{sent.qikinkOrderId}</dd>
                </>
              )}
              {sent.remoteStatus && (
                <>
                  <dt>Status</dt>
                  <dd>{sent.remoteStatus}</dd>
                </>
              )}
              <dt>Sent to</dt>
              <dd className="font-mono text-xs">{sent.host}</dd>
            </dl>

            {/* The single most confusing thing about testing this: a sandbox
                order is real, but it is not in the dashboard, and no amount of
                searching there will find it. */}
            {environment === "sandbox" && (
              <p className="mt-3 rounded-md border bg-background p-2 text-xs text-muted-foreground">
                This is a <strong>sandbox</strong> order. It will{" "}
                <strong>not</strong> appear at dashboard.qikink.com — that shows
                your live account only. The status above was read back from the
                sandbox API, which is the only place this order exists.
              </p>
            )}

            {!sent.remoteStatus && sent.qikinkOrderId && (
              <p className="mt-3 text-xs text-muted-foreground">
                Qikink returned an id but would not read the order back yet. That
                is usually just their indexing lagging — not a failed send.
              </p>
            )}
          </div>
        )}

        <Button onClick={handleSend} disabled={pending}>
          {pending ? "Sending…" : "Send test order"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
