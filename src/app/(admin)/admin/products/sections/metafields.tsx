"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useField } from "@/lib/form-store";
import {
  useProductStore,
  type MetafieldDraft,
  type ProductDraft,
} from "../product-draft";
import type { ProductFacets } from "../actions";

/**
 * Custom fields, as key/value pairs.
 *
 * Deliberately generic rather than a form of named inputs. The keys come from
 * whatever the store already uses — this catalogue arrived with `custom.badge`
 * and `custom.key_info` alongside forty of Shopify's taxonomy keys — and a
 * fixed set of inputs would silently drop everything it did not know about the
 * next time the product was saved. `save_product` replaces the whole map, so
 * what is shown here has to be all of it.
 */

const KEY_PATTERN = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;

export function MetafieldsSection({ facets }: { facets: ProductFacets }) {
  const store = useProductStore();
  const [rows] = useField<ProductDraft, "metafields">(store, "metafields");

  const listId = "metafield-key-suggestions";

  // Keys already used elsewhere in the catalogue, minus the ones on this
  // product — suggesting a key the product already has is noise.
  const suggestions = useMemo(() => {
    const used = new Set(rows.map((r) => r.key.trim()));
    return (facets.metafield_keys ?? []).filter((k) => !used.has(k));
  }, [facets.metafield_keys, rows]);

  function update(id: string, patch: Partial<MetafieldDraft>) {
    store.set(
      "metafields",
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  function remove(id: string) {
    store.set("metafields", rows.filter((r) => r.id !== id));
  }

  function add() {
    store.set("metafields", [
      ...rows,
      // Random rather than index-derived: an index-keyed row would collide with
      // a row that was just deleted, and React would reuse the wrong input.
      { id: crypto.randomUUID(), key: "", value: "" },
    ]);
  }

  // Only complain about a key that is both non-empty and malformed — an empty
  // row is one the operator has not started, and it is dropped at save.
  const duplicates = new Set(
    rows
      .map((r) => r.key.trim())
      .filter((key, i, all) => key !== "" && all.indexOf(key) !== i)
  );

  return (
    <Card id="section-metafields" className="scroll-mt-32">
      <CardHeader>
        <CardTitle className="text-base">Metafields</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No custom fields. Use these for details the built-in fields have no
            place for — a badge, a care note, a fabric composition.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="hidden gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <Label className="text-xs text-muted-foreground">Key</Label>
              <Label className="text-xs text-muted-foreground">Value</Label>
              <span className="w-8" />
            </div>

            {rows.map((row) => {
              const key = row.key.trim();
              const invalid = key !== "" && !KEY_PATTERN.test(key);
              const duplicated = duplicates.has(key);

              return (
                <div key={row.id} className="space-y-1">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                    <Input
                      value={row.key}
                      list={listId}
                      spellCheck={false}
                      placeholder="custom.badge"
                      aria-label="Metafield key"
                      aria-invalid={invalid || duplicated || undefined}
                      onChange={(e) => update(row.id, { key: e.target.value })}
                      className="font-mono text-xs"
                    />
                    <Input
                      value={row.value}
                      placeholder="PRE-ORDER"
                      aria-label="Metafield value"
                      onChange={(e) => update(row.id, { value: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${row.key || "metafield"}`}
                      onClick={() => remove(row.id)}
                      className="justify-self-start text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  {invalid && (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      Use lowercase letters, numbers, dots, hyphens and
                      underscores — for example <code>custom.badge</code>.
                    </p>
                  )}
                  {!invalid && duplicated && (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      Another row already uses this key. Only the last one is
                      saved.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <datalist id={listId}>
          {suggestions.map((key) => (
            <option key={key} value={key} />
          ))}
        </datalist>

        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="size-3.5" />
            Add metafield
          </Button>
          <p className="text-xs text-muted-foreground">
            Rows with an empty key or value are not saved.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
