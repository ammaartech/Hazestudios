"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import type { ShopSettings } from "@/lib/types";
import { updateShopSettings } from "../actions";

export function GeneralForm({ settings }: { settings: ShopSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [storeName, setStoreName] = useState(settings.store_name);
  const [legalName, setLegalName] = useState(settings.legal_name ?? "");
  const [email, setEmail] = useState(settings.email ?? "");
  const [phone, setPhone] = useState(settings.phone ?? "");
  const [currency, setCurrency] = useState(settings.currency);
  const [timezone, setTimezone] = useState(settings.timezone);

  function handleSave() {
    startTransition(async () => {
      const result = await updateShopSettings({
        store_name: storeName,
        legal_name: legalName || null,
        email: email || null,
        phone: phone || null,
        currency,
        timezone,
      });
      if (result.error) toast.error(result.error);
      else {
        toast.success("Store details saved");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Store details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="store-name">Store name</Label>
            <Input
              id="store-name"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="legal-name">Legal business name</Label>
            <Input
              id="legal-name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-email">Store contact email</Label>
            <Input
              id="store-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-phone">Phone</Label>
            <Input
              id="store-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="currency">Currency (ISO code)</Label>
            <Input
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              placeholder="USD"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">Time zone</Label>
            <Input
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/Toronto"
            />
          </div>
        </div>
        <Button onClick={handleSave} disabled={pending || !storeName.trim()}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
