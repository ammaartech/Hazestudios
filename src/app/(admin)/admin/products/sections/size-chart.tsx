"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Plus, Ruler, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useField, useFields } from "@/lib/form-store";
import {
  GARMENT_PRESETS,
  MEASUREMENTS,
  chartMeasurement,
  customMeasurementKey,
  preset as findPreset,
  suggestPreset,
  type SizeChart,
  type SizeChartRow,
} from "@/lib/size-chart";
import { activeOptions } from "@/lib/variants";
import { cn } from "@/lib/utils";
import { useProductStore } from "../product-draft";

/**
 * Size chart editor.
 *
 * Two decisions shape this UI:
 *
 * 1. Measurements are chosen per product, not fixed. A t-shirt needs chest and
 *    length; a dress needs bust, waist and hip. A fixed column set would leave
 *    most of the grid blank on every product.
 * 2. Nothing is mandatory. Every cell may be left empty, and empty columns and
 *    rows are pruned at save so the storefront never renders a blank column.
 *
 * All entry is in inches; the storefront offers the shopper a cm toggle.
 */

/** Sizes seeded from the product's own Size option, when it has one. */
function useSizeOptionValues(): string[] {
  const store = useProductStore();
  const { options } = useFields(store, ["options"]);

  return useMemo(() => {
    const sizeOption = activeOptions(options).find(
      (o) => o.name.trim().toLowerCase() === "size"
    );
    return sizeOption?.values ?? [];
  }, [options]);
}

function MeasurementChip({
  label,
  help,
  selected,
  onToggle,
}: {
  label: string;
  /** How-to-measure copy, shown on hover. Custom measurements have none. */
  help?: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const chip = (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "hover:bg-muted"
      )}
    >
      {label}
      {selected ? (
        <X className="size-3" />
      ) : (
        <Plus className="size-3 opacity-60" />
      )}
    </button>
  );

  // No help copy (custom measurements) → no empty tooltip.
  if (!help) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent className="max-w-64">{help}</TooltipContent>
    </Tooltip>
  );
}

export function SizeChartSection() {
  const store = useProductStore();
  const [enabled] = useField(store, "size_chart_enabled");
  const [chart, setChart] = useField(store, "size_chart");
  const { product_type, category, title } = useFields(store, [
    "product_type",
    "category",
    "title",
  ]);
  const sizeOptionValues = useSizeOptionValues();

  // Inline "add custom measurement" field, revealed by the Custom chip.
  const [addingCustom, setAddingCustom] = useState(false);
  const [customLabel, setCustomLabel] = useState("");

  const patch = useCallback(
    (next: Partial<SizeChart>) => setChart({ ...chart, ...next }),
    [chart, setChart]
  );

  /**
   * Turning the chart on for the first time seeds it from the product's own
   * type and its Size option, so the common case is already filled in and the
   * operator only types numbers.
   */
  function toggleEnabled(on: boolean) {
    if (on && chart.measurements.length === 0 && chart.rows.length === 0) {
      const guess = suggestPreset(product_type, category, title);
      const sizes = sizeOptionValues.length ? sizeOptionValues : guess.sizes;
      setChart({
        preset: guess.id,
        measurements: guess.measurements,
        rows: sizes.map((size) => ({ size, values: {} })),
        note: "",
        custom: [],
      });
    }
    store.set("size_chart_enabled", on);
  }

  /** Swapping preset replaces the columns but keeps any values already typed. */
  function applyPreset(id: string) {
    const p = findPreset(id);
    if (!p) return;
    if (id === "custom") {
      patch({ preset: id });
      return;
    }
    patch({
      preset: id,
      // Preset seeds its own columns, but the operator's custom ones aren't part
      // of any preset — carry them across the switch so they don't silently drop.
      measurements: [...p.measurements, ...chart.custom.map((m) => m.key)],
      rows: chart.rows.length
        ? chart.rows
        : (sizeOptionValues.length ? sizeOptionValues : p.sizes).map((size) => ({
            size,
            values: {},
          })),
    });
  }

  function toggleMeasurement(key: string) {
    const selected = chart.measurements.includes(key);
    patch({
      preset: "custom",
      // Values for a removed column are intentionally left in place — an
      // accidental deselect should not destroy typed numbers, and the save
      // prunes anything not in `measurements` anyway.
      measurements: selected
        ? chart.measurements.filter((m) => m !== key)
        : [...chart.measurements, key],
    });
  }

  /**
   * Add an operator-named column that isn't in the built-in vocabulary. It
   * becomes both a selected measurement and a definition carried on the chart,
   * so it survives save and renders on the storefront like any other column.
   */
  function addCustomMeasurement(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const key = customMeasurementKey(trimmed, [
      ...MEASUREMENTS.map((m) => m.key),
      ...chart.custom.map((m) => m.key),
    ]);
    patch({
      preset: "custom",
      custom: [...chart.custom, { key, label: trimmed, help: "" }],
      measurements: [...chart.measurements, key],
    });
  }

  /** Removing a custom chip deletes its definition — there's no list to re-add it from. */
  function removeCustomMeasurement(key: string) {
    patch({
      preset: "custom",
      measurements: chart.measurements.filter((m) => m !== key),
      custom: chart.custom.filter((m) => m.key !== key),
    });
  }

  function commitCustom() {
    addCustomMeasurement(customLabel);
    setCustomLabel("");
    setAddingCustom(false);
  }

  function cancelCustom() {
    setCustomLabel("");
    setAddingCustom(false);
  }

  function setRow(index: number, next: SizeChartRow) {
    patch({ rows: chart.rows.map((row, i) => (i === index ? next : row)) });
  }

  function setCell(index: number, key: string, value: string) {
    const row = chart.rows[index];
    setRow(index, { ...row, values: { ...row.values, [key]: value } });
  }

  function addRow() {
    patch({ rows: [...chart.rows, { size: "", values: {} }] });
  }

  function removeRow(index: number) {
    patch({ rows: chart.rows.filter((_, i) => i !== index) });
  }

  function syncSizesFromOption() {
    const existing = new Map(chart.rows.map((r) => [r.size, r]));
    patch({
      rows: sizeOptionValues.map(
        (size) => existing.get(size) ?? { size, values: {} }
      ),
    });
  }

  const sizesMatchOption =
    sizeOptionValues.length > 0 &&
    sizeOptionValues.length === chart.rows.length &&
    sizeOptionValues.every((size, i) => chart.rows[i]?.size === size);

  return (
    <Card id="section-size-chart" className="scroll-mt-32">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Ruler className="size-4 text-muted-foreground" />
          Size chart
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox
            checked={enabled}
            onCheckedChange={(c) => toggleEnabled(c === true)}
            className="mt-0.5"
          />
          <span>
            This product needs a size chart
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Adds a “Size guide” link on the product page. Measurements are
              entered in inches; shoppers can switch to centimetres.
            </span>
          </span>
        </label>

        {!enabled ? (
          <p className="border-t border-border pt-4 text-xs text-muted-foreground">
            Accessories, fragrance and one-size products usually skip this.
          </p>
        ) : (
          <div className="space-y-5 border-t border-border pt-4">
            {/* Preset ------------------------------------------------------ */}
            <div>
              <p className="mb-2 text-sm font-medium">Garment type</p>
              <div className="flex flex-wrap gap-2">
                {GARMENT_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p.id)}
                    aria-pressed={chart.preset === p.id}
                    className={cn(
                      "cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150",
                      chart.preset === p.id
                        ? "border-foreground/30 bg-muted"
                        : "hover:bg-muted"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Picks a starting set of measurements. Add or remove any of them
                below — the choice only seeds the table.
              </p>
            </div>

            {/* Measurements ------------------------------------------------ */}
            <div>
              <p className="mb-2 text-sm font-medium">
                Measurements{" "}
                <span className="font-normal text-muted-foreground">
                  ({chart.measurements.length} selected)
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                {MEASUREMENTS.map((m) => (
                  <MeasurementChip
                    key={m.key}
                    label={m.label}
                    help={m.help}
                    selected={chart.measurements.includes(m.key)}
                    onToggle={() => toggleMeasurement(m.key)}
                  />
                ))}

                {/* Operator-defined columns render as always-selected chips; the
                    X deletes them outright. */}
                {chart.custom.map((m) => (
                  <MeasurementChip
                    key={m.key}
                    label={m.label}
                    selected
                    onToggle={() => removeCustomMeasurement(m.key)}
                  />
                ))}

                {/* Add-your-own control — mirrors the "Custom" affordance in
                    Garment type, but here it opens an inline name field. */}
                {addingCustom ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-primary py-1 pr-1 pl-3">
                    <input
                      autoFocus
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitCustom();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelCustom();
                        }
                      }}
                      onBlur={() => {
                        // Clicking Add fires before blur commits nothing; a click
                        // elsewhere cancels an empty field.
                        if (!customLabel.trim()) cancelCustom();
                      }}
                      placeholder="e.g. Cuff"
                      aria-label="Custom measurement name"
                      maxLength={40}
                      className="w-28 bg-transparent text-[13px] font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={commitCustom}
                      disabled={!customLabel.trim()}
                      aria-label="Add custom measurement"
                      className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-primary transition-colors duration-150 hover:bg-primary hover:text-primary-foreground disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Check className="size-3.5" />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingCustom(true)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:border-solid hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="size-3" />
                    Custom
                  </button>
                )}
              </div>
            </div>

            {/* Grid -------------------------------------------------------- */}
            {chart.measurements.length === 0 ? (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                Pick at least one measurement to build the table.
              </p>
            ) : (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    Measurements in inches
                    <span className="ml-2 font-normal text-muted-foreground">
                      Leave any cell blank if it does not apply.
                    </span>
                  </p>
                  {sizeOptionValues.length > 0 && !sizesMatchOption && (
                    <button
                      type="button"
                      onClick={syncSizesFromOption}
                      className="cursor-pointer text-[13px] font-medium text-primary hover:underline"
                    >
                      Use sizes from variants ({sizeOptionValues.join(", ")})
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="w-28 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                          Size
                        </th>
                        {chart.measurements.map((key) => (
                          <th
                            key={key}
                            className="min-w-24 px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                          >
                            {chartMeasurement(chart, key)?.label ?? key}
                          </th>
                        ))}
                        <th className="w-10 px-2" aria-label="Remove size" />
                      </tr>
                    </thead>
                    <tbody>
                      {chart.rows.map((row, index) => (
                        <tr key={index} className="border-b last:border-b-0">
                          <td className="p-1.5">
                            <Input
                              value={row.size}
                              onChange={(e) =>
                                setRow(index, { ...row, size: e.target.value })
                              }
                              placeholder="S"
                              aria-label={`Size name for row ${index + 1}`}
                              className="h-8 font-medium"
                            />
                          </td>
                          {chart.measurements.map((key) => (
                            <td key={key} className="p-1.5">
                              <Input
                                value={row.values[key] ?? ""}
                                onChange={(e) =>
                                  setCell(index, key, e.target.value)
                                }
                                // Free text, not type=number: "26-28" is a
                                // legitimate entry and a number input rejects it.
                                inputMode="decimal"
                                placeholder="—"
                                aria-label={`${chartMeasurement(chart, key)?.label ?? key} for size ${row.size || index + 1}`}
                                className="h-8 tabular-nums"
                              />
                            </td>
                          ))}
                          <td className="p-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => removeRow(index)}
                              aria-label={`Remove size ${row.size || index + 1}`}
                              className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  onClick={addRow}
                  className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
                >
                  <Plus className="size-3.5" />
                  Add size
                </button>
              </div>
            )}

            {/* Note -------------------------------------------------------- */}
            <div>
              <label
                htmlFor="size-chart-note"
                className="mb-1.5 block text-sm font-medium"
              >
                Fit note{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <Textarea
                id="size-chart-note"
                value={chart.note}
                onChange={(e) => patch({ note: e.target.value })}
                rows={2}
                placeholder="e.g. Model is 5'9&quot; and wears a size S. Relaxed fit — size down for a closer cut."
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
