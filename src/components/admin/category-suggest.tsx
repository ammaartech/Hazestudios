"use client";

import { useState, useTransition } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  suggestProductCategory,
  type CategorySuggestion,
} from "@/app/(admin)/admin/products/ai-actions";

/**
 * Reads the product photos and proposes a category + product type.
 *
 * Deliberately suggest-and-confirm, not silent autofill: the Category hint says
 * it "helps set the right tax rate and shipping profile", so an AI guess writing
 * that field unseen is the wrong default. The suggestion is one click to accept
 * per field, which is as fast as autofill but keeps the operator in control —
 * and applied values are just text in the same inputs, freely editable.
 */
export function CategorySuggest({
  imageUrls,
  existingCategories,
  existingTypes,
  currentCategory,
  currentType,
  onCategory,
  onType,
}: {
  imageUrls: string[];
  existingCategories: string[];
  existingTypes: string[];
  currentCategory: string;
  currentType: string;
  onCategory: (value: string) => void;
  onType: (value: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CategorySuggestion | null>(null);

  const hasImages = imageUrls.length > 0;

  function run() {
    setResult(null);
    startTransition(async () => {
      setResult(
        await suggestProductCategory({
          imageUrls,
          existingCategories,
          existingTypes,
        })
      );
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={pending || !hasImages}
        className="w-full justify-center gap-1.5"
      >
        <Sparkles className={cn("size-3.5", pending && "animate-pulse")} />
        {pending ? "Reading photos…" : "Suggest from photos"}
      </Button>

      {!hasImages && (
        <p className="text-xs text-muted-foreground">
          Add a product photo above to suggest a category.
        </p>
      )}

      {result && !result.ok && (
        <p
          className={cn(
            "text-xs",
            result.reason === "not-configured"
              ? "text-muted-foreground"
              : "text-destructive"
          )}
        >
          {result.message}
        </p>
      )}

      {result?.ok && (
        <div className="space-y-2 rounded-lg border border-dashed border-input bg-muted/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Suggested</p>
            {result.confidence === "low" && (
              <span className="text-[11px] text-muted-foreground">
                low confidence — double-check
              </span>
            )}
          </div>

          {result.category && (
            <SuggestionChip
              label="Category"
              value={result.category}
              applied={currentCategory.trim() === result.category}
              onApply={() => onCategory(result.category)}
            />
          )}
          {result.productType && (
            <SuggestionChip
              label="Type"
              value={result.productType}
              applied={currentType.trim() === result.productType}
              onApply={() => onType(result.productType)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionChip({
  label,
  value,
  applied,
  onApply,
}: {
  label: string;
  value: string;
  applied: boolean;
  onApply: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onApply}
      disabled={applied}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150",
        applied
          ? "cursor-default text-muted-foreground"
          : "cursor-pointer hover:bg-accent"
      )}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          applied ? "border-primary bg-primary text-primary-foreground" : "border-input"
        )}
      >
        {applied && <Check className="size-2.5" />}
      </span>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {value}
      </span>
      {!applied && <span className="text-xs text-primary">Apply</span>}
    </button>
  );
}
