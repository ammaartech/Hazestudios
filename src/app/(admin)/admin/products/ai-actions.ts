"use server";

import { classifyProductImages, geminiConfigured } from "@/lib/ai/gemini";
import { createClient } from "@/lib/supabase/server";

/**
 * AI-assisted product fields, backed by Google Gemini.
 *
 * A Server Action is a public POST endpoint, so this gates on `is_staff()`
 * before spending a model call — the hidden button in the editor is a hint, not
 * the boundary. Every failure path (no key, no usable image, a blocked or
 * empty response) returns a typed reason rather than throwing, because a
 * suggestion feature must never break the save flow it sits next to.
 */

export type CategorySuggestion =
  | {
      ok: true;
      category: string;
      productType: string;
      confidence: "high" | "medium" | "low";
    }
  | {
      ok: false;
      reason: "not-configured" | "no-images" | "unauthorized" | "error";
      message: string;
    };

export async function suggestProductCategory(input: {
  imageUrls: string[];
  existingCategories?: string[];
  existingTypes?: string[];
}): Promise<CategorySuggestion> {
  // Only publicly-fetchable storage URLs can be classified — a blob: URL from
  // an in-flight upload can't be fetched and inlined.
  const urls = input.imageUrls.filter((u) => /^https?:\/\//i.test(u));
  if (!urls.length) {
    return {
      ok: false,
      reason: "no-images",
      message: "Upload a photo first, then try suggesting a category.",
    };
  }

  if (!geminiConfigured()) {
    return {
      ok: false,
      reason: "not-configured",
      message: "Category suggestions aren't set up on this store yet.",
    };
  }

  // Staff gate — the admin shell blocks non-staff at the route, but a Server
  // Action is reachable directly, so re-check before any spend.
  try {
    const supabase = await createClient();
    const { data: isStaff } = await supabase.rpc("is_staff");
    if (!isStaff) {
      return {
        ok: false,
        reason: "unauthorized",
        message: "You do not have permission to use this.",
      };
    }
  } catch {
    return {
      ok: false,
      reason: "error",
      message: "Could not verify your session. Try again.",
    };
  }

  const result = await classifyProductImages(urls, {
    existingCategories: input.existingCategories,
    existingTypes: input.existingTypes,
  });

  if (!result) {
    return {
      ok: false,
      reason: "error",
      message: "Couldn't read that photo. Try a clearer one, or set it by hand.",
    };
  }

  return { ok: true, ...result };
}
