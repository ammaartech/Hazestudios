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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ShopSettings } from "@/lib/types";
import { updateShopSettings } from "../actions";

const POLICY_FIELDS = [
  { key: "privacy", label: "Privacy policy" },
  { key: "refund", label: "Refund policy" },
  { key: "shipping", label: "Shipping policy" },
  { key: "terms", label: "Terms of service" },
] as const;

export function PoliciesForm({ settings }: { settings: ShopSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [policies, setPolicies] = useState<Record<string, string>>({
    privacy: settings.policies?.privacy ?? "",
    refund: settings.policies?.refund ?? "",
    shipping: settings.policies?.shipping ?? "",
    terms: settings.policies?.terms ?? "",
  });

  function handleSave() {
    startTransition(async () => {
      const result = await updateShopSettings({ policies });
      if (result.error) toast.error(result.error);
      else {
        toast.success("Policies saved");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      {POLICY_FIELDS.map((field) => (
        <Card key={field.key}>
          <CardHeader>
            <CardTitle className="text-base">{field.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor={`policy-${field.key}`} className="sr-only">
              {field.label}
            </Label>
            <Textarea
              id={`policy-${field.key}`}
              rows={6}
              value={policies[field.key]}
              onChange={(e) =>
                setPolicies((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
              placeholder={`Write your ${field.label.toLowerCase()} here. It will be shown on the storefront once it launches.`}
            />
          </CardContent>
        </Card>
      ))}
      <Button onClick={handleSave} disabled={pending}>
        {pending ? "Saving…" : "Save policies"}
      </Button>
    </div>
  );
}
