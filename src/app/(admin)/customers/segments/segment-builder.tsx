"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Segment, SegmentFilter } from "@/lib/types";
import { saveSegment } from "../actions";

const FIELDS: { value: SegmentFilter["field"]; label: string }[] = [
  { value: "total_spent", label: "Amount spent" },
  { value: "orders_count", label: "Number of orders" },
  { value: "country", label: "Country" },
  { value: "accepts_marketing", label: "Accepts marketing" },
  { value: "tag", label: "Tag" },
];

function operatorsFor(field: SegmentFilter["field"]) {
  if (field === "total_spent" || field === "orders_count") {
    return [
      { value: "greater_than", label: "is greater than" },
      { value: "less_than", label: "is less than" },
      { value: "equals", label: "is equal to" },
    ] as const;
  }
  if (field === "accepts_marketing") {
    return [{ value: "equals", label: "is" }] as const;
  }
  return [
    { value: "equals", label: "is equal to" },
    { value: "contains", label: "contains" },
  ] as const;
}

export function SegmentBuilder({ segment }: { segment?: Segment }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(segment?.name ?? "");
  const [filters, setFilters] = useState<(SegmentFilter & { key: string })[]>(
    (segment?.filters ?? []).map((f) => ({ ...f, key: crypto.randomUUID() }))
  );
  const [pending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await saveSegment({
        id: segment?.id,
        name,
        filters: filters
          .filter((f) => f.value.trim())
          .map(({ key: _key, ...rest }) => rest),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(segment ? "Segment updated" : "Segment created");
      setOpen(false);
      if (!segment) {
        setName("");
        setFilters([]);
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {segment ? (
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        ) : (
          <Button>Create segment</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {segment ? "Edit segment" : "Create segment"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="segment-name">Name</Label>
            <Input
              id="segment-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. VIP customers"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                Customers must match all filters
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setFilters([
                    ...filters,
                    {
                      key: crypto.randomUUID(),
                      field: "total_spent",
                      operator: "greater_than",
                      value: "",
                    },
                  ])
                }
              >
                <Plus className="size-4" />
                Add filter
              </Button>
            </div>

            {filters.map((filter) => {
              const ops = operatorsFor(filter.field);
              return (
                <div key={filter.key} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={filter.field}
                    onValueChange={(field) =>
                      setFilters(
                        filters.map((f) =>
                          f.key === filter.key
                            ? {
                                ...f,
                                field: field as SegmentFilter["field"],
                                operator: operatorsFor(
                                  field as SegmentFilter["field"]
                                )[0].value,
                                value: "",
                              }
                            : f
                        )
                      )
                    }
                  >
                    <SelectTrigger className="w-44" aria-label="Filter field">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={filter.operator}
                    onValueChange={(operator) =>
                      setFilters(
                        filters.map((f) =>
                          f.key === filter.key
                            ? {
                                ...f,
                                operator: operator as SegmentFilter["operator"],
                              }
                            : f
                        )
                      )
                    }
                  >
                    <SelectTrigger className="w-40" aria-label="Filter operator">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ops.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {filter.field === "accepts_marketing" ? (
                    <Select
                      value={filter.value || "true"}
                      onValueChange={(value) =>
                        setFilters(
                          filters.map((f) =>
                            f.key === filter.key ? { ...f, value } : f
                          )
                        )
                      }
                    >
                      <SelectTrigger className="w-28" aria-label="Filter value">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Yes</SelectItem>
                        <SelectItem value="false">No</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={filter.value}
                      aria-label="Filter value"
                      className="w-32"
                      placeholder={
                        filter.field === "total_spent"
                          ? "100"
                          : filter.field === "orders_count"
                            ? "3"
                            : "Value"
                      }
                      onChange={(e) =>
                        setFilters(
                          filters.map((f) =>
                            f.key === filter.key
                              ? { ...f, value: e.target.value }
                              : f
                          )
                        )
                      }
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove filter"
                    onClick={() =>
                      setFilters(filters.filter((f) => f.key !== filter.key))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>

          <Button
            onClick={handleSave}
            disabled={pending || !name.trim()}
            className="w-full"
          >
            {pending ? "Saving…" : "Save segment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
