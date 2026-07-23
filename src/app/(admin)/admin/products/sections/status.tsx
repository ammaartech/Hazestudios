"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFields } from "@/lib/form-store";
import { formatDateTime } from "@/lib/format";
import type { ProductStatus } from "@/lib/types";
import { useProductStore, type ProductDraft } from "../product-draft";

const KEYS = ["status", "published_at"] as const;

const COPY: Record<ProductStatus, string> = {
  draft: "Hidden from the storefront. Only staff can see it.",
  active: "Live on the storefront and available to buy.",
  archived: "Hidden and excluded from lists, but orders keep their history.",
};

const DOT: Record<ProductStatus, string> = {
  draft: "bg-muted-foreground",
  active: "bg-primary",
  archived: "bg-foreground/40",
};

export function StatusSection() {
  const store = useProductStore();
  const v = useFields<ProductDraft, (typeof KEYS)[number]>(store, KEYS);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select
          value={v.status}
          onValueChange={(next) => store.set("status", next as ProductStatus)}
        >
          <SelectTrigger aria-label="Product status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(COPY) as ProductStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {/* Shape as well as hue, so status survives greyscale and
                    colour-vision differences. */}
                <span className="flex items-center gap-2">
                  <span className={`size-1.5 rounded-full ${DOT[s]}`} />
                  <span className="capitalize">{s}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="text-xs text-muted-foreground">{COPY[v.status]}</p>

        {v.status === "active" && v.published_at && (
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Published {formatDateTime(v.published_at)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
