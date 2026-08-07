"use client";

import { useEffect } from "react";
import { QIKINK_PASTE_KEY } from "./paste-qikink-dialog";
import type { QikinkPasteResult } from "@/lib/qikink-paste";
import type { OptionDraft, VariantOverride } from "@/lib/variants";
import type { ProductDraft } from "./product-draft";
import type { ProductStore } from "./product-draft";

/**
 * Applies a paste-from-Qikink draft handed off through sessionStorage (see
 * `paste-qikink-dialog.tsx`) to a freshly-mounted new-product form.
 *
 * Only ever called with `enabled` true on the Add Product page, and only
 * once: the key is removed as soon as it's read, so navigating back to
 * `/admin/products/new` later — say, to add a second Qikink product — starts
 * from a clean draft rather than replaying the last paste.
 */
export function useQikinkPaste(store: ProductStore, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const raw = sessionStorage.getItem(QIKINK_PASTE_KEY);
    sessionStorage.removeItem(QIKINK_PASTE_KEY);
    if (!raw) return;

    let parsed: QikinkPasteResult;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed.variants.length) return;

    const options: OptionDraft[] = parsed.options.map((o, i) => ({
      key: `qikink-paste-option-${i}`,
      name: o.name,
      values: o.values,
    }));

    const variantOverrides: Record<string, VariantOverride> = {};
    for (const v of parsed.variants) {
      variantOverrides[v.title] = { sku: v.sku };
    }

    const patch: Partial<ProductDraft> = { options, variantOverrides };
    if (parsed.title) patch.title = parsed.title;

    store.patch(patch);
    // Deliberately runs once per mount: `store` and `enabled` are stable for
    // the lifetime of a single visit to the new-product page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
