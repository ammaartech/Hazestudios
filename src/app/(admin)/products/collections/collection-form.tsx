"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/admin/page-header";
import type { CollectionRule, CollectionType, Product } from "@/lib/types";
import { saveCollection, deleteCollection, type CollectionPayload } from "./actions";

const RULE_FIELDS: { value: CollectionRule["field"]; label: string }[] = [
  { value: "tag", label: "Tag" },
  { value: "title", label: "Title" },
  { value: "vendor", label: "Vendor" },
  { value: "product_type", label: "Product type" },
  { value: "price", label: "Price" },
];

const TEXT_OPERATORS: { value: CollectionRule["operator"]; label: string }[] = [
  { value: "equals", label: "is equal to" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
];

const PRICE_OPERATORS: { value: CollectionRule["operator"]; label: string }[] = [
  { value: "equals", label: "is equal to" },
  { value: "greater_than", label: "is greater than" },
  { value: "less_than", label: "is less than" },
];

export interface CollectionFormInitial {
  id?: string;
  title: string;
  description: string;
  type: CollectionType;
  rules: CollectionRule[];
  product_ids: string[];
}

export function CollectionForm({
  initial,
  products,
}: {
  initial: CollectionFormInitial;
  products: Pick<Product, "id" | "title" | "status">[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [type, setType] = useState<CollectionType>(initial.type);
  const [rules, setRules] = useState<(CollectionRule & { key: string })[]>(
    initial.rules.map((r) => ({ ...r, key: crypto.randomUUID() }))
  );
  const [productIds, setProductIds] = useState<string[]>(initial.product_ids);
  const [productFilter, setProductFilter] = useState("");

  function handleSave() {
    const payload: CollectionPayload = {
      id: initial.id,
      title,
      description,
      type,
      rules: rules
        .filter((r) => r.value.trim())
        .map(({ key: _key, ...rest }) => rest),
      product_ids: productIds,
    };
    startTransition(async () => {
      const result = await saveCollection(payload);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(initial.id ? "Collection updated" : "Collection created");
      router.push("/products/collections");
      router.refresh();
    });
  }

  function handleDelete() {
    if (!initial.id) return;
    if (!window.confirm("Delete this collection?")) return;
    startTransition(async () => {
      const result = await deleteCollection(initial.id!);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Collection deleted");
      router.push("/products/collections");
      router.refresh();
    });
  }

  const visibleProducts = products.filter((p) =>
    p.title.toLowerCase().includes(productFilter.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title={initial.id ? title || "Edit collection" : "Create collection"}
        backHref="/products/collections"
        backLabel="Collections"
      >
        {initial.id && (
          <Button
            variant="outline"
            onClick={handleDelete}
            disabled={pending}
            className="text-destructive hover:text-destructive"
          >
            Delete
          </Button>
        )}
        <Button onClick={handleSave} disabled={pending || !title.trim()}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </PageHeader>

      <div className="space-y-5">
        <Card>
          <CardContent className="space-y-4 pt-0">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Summer collection"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Collection type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <RadioGroup
              value={type}
              onValueChange={(v) => setType(v as CollectionType)}
              className="space-y-1"
            >
              <label className="flex cursor-pointer items-start gap-2">
                <RadioGroupItem value="manual" className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">Manual</span>
                  <span className="block text-xs text-muted-foreground">
                    Add products to this collection one by one.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <RadioGroupItem value="smart" className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">Smart</span>
                  <span className="block text-xs text-muted-foreground">
                    Products matching the conditions are included automatically.
                  </span>
                </span>
              </label>
            </RadioGroup>

            {type === "smart" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Products must match all conditions
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setRules([
                        ...rules,
                        {
                          key: crypto.randomUUID(),
                          field: "tag",
                          operator: "equals",
                          value: "",
                        },
                      ])
                    }
                  >
                    <Plus className="size-4" />
                    Add condition
                  </Button>
                </div>
                {rules.map((rule) => {
                  const operators =
                    rule.field === "price" ? PRICE_OPERATORS : TEXT_OPERATORS;
                  return (
                    <div key={rule.key} className="flex flex-wrap items-center gap-2">
                      <Select
                        value={rule.field}
                        onValueChange={(field) =>
                          setRules(
                            rules.map((r) =>
                              r.key === rule.key
                                ? {
                                    ...r,
                                    field: field as CollectionRule["field"],
                                    operator: "equals",
                                  }
                                : r
                            )
                          )
                        }
                      >
                        <SelectTrigger className="w-36" aria-label="Condition field">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RULE_FIELDS.map((f) => (
                            <SelectItem key={f.value} value={f.value}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={rule.operator}
                        onValueChange={(operator) =>
                          setRules(
                            rules.map((r) =>
                              r.key === rule.key
                                ? {
                                    ...r,
                                    operator: operator as CollectionRule["operator"],
                                  }
                                : r
                            )
                          )
                        }
                      >
                        <SelectTrigger className="w-40" aria-label="Condition operator">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {operators.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={rule.value}
                        aria-label="Condition value"
                        placeholder={rule.field === "price" ? "0.00" : "Value"}
                        className="w-40"
                        onChange={(e) =>
                          setRules(
                            rules.map((r) =>
                              r.key === rule.key ? { ...r, value: e.target.value } : r
                            )
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove condition"
                        onClick={() => setRules(rules.filter((r) => r.key !== rule.key))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {type === "manual" && (
              <div className="space-y-2">
                <Label htmlFor="product-filter">Products</Label>
                <Input
                  id="product-filter"
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                  placeholder="Filter products"
                />
                <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-input p-3">
                  {visibleProducts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No products.</p>
                  ) : (
                    visibleProducts.map((p) => (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={productIds.includes(p.id)}
                          onCheckedChange={(checked) =>
                            setProductIds(
                              checked
                                ? [...productIds, p.id]
                                : productIds.filter((id) => id !== p.id)
                            )
                          }
                        />
                        {p.title}
                        {p.status !== "active" && (
                          <span className="text-xs text-muted-foreground">
                            ({p.status})
                          </span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
