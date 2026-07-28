"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CsvProduct } from "@/lib/product-csv";

/**
 * Server side of the CSV import.
 *
 * The file is parsed in the browser, not here: an 845-product export is 2.2 MB
 * of CSV that expands past 4 MB as JSON, and Next caps a Server Action body at
 * 1 MB. Parsing on the client also means the operator sees the row counts and
 * the error list before anything is written — a preview that required a
 * round trip per attempt would be a much worse trade.
 *
 * So the client sends already-mapped `save_product` payloads in size-bounded
 * chunks, and each chunk is one `import_products` call: one transaction, one
 * round trip, per-product failure isolation inside it.
 */

export interface ChunkResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { handle: string; message: string }[];
}

export type ImportTotals = ChunkResult;

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const EMPTY_TOTALS: ImportTotals = {
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  errors: [],
};

/**
 * Opens the ledger row. Returning the id up front means a run that dies
 * halfway — closed tab, dropped connection — still leaves a record saying what
 * was attempted, rather than vanishing.
 */
export async function beginImport(
  filename: string,
  total: number
): Promise<ActionResult<{ runId: string }>> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to import products." };

  const { data, error } = await supabase
    .from("product_imports")
    .insert({
      filename: filename.slice(0, 255),
      total,
      status: "running",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { runId: data.id as string } };
}

/**
 * Writes one chunk and records the run's progress so far.
 *
 * `totals` is the client's running tally including this chunk's result, so the
 * ledger row stays accurate without a read-modify-write. Next dispatches Server
 * Actions one at a time per client, so these arrive in order.
 */
export async function importChunk(
  runId: string,
  products: CsvProduct[],
  overwrite: boolean
): Promise<ActionResult<ChunkResult>> {
  if (!products.length) return { ok: true, data: EMPTY_TOTALS };

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in and try again." };

  const { data, error } = await supabase.rpc("import_products", {
    payload: { overwrite, products },
  });

  if (error) return { ok: false, error: error.message };

  return { ok: true, data: data as ChunkResult };
}

/** Records the running tally on the ledger row without closing the run. */
export async function recordProgress(runId: string, totals: ImportTotals) {
  const supabase = await createClient();
  await supabase
    .from("product_imports")
    .update({
      created: totals.created,
      updated: totals.updated,
      skipped: totals.skipped,
      failed: totals.failed,
      errors: totals.errors.slice(0, 50),
    })
    .eq("id", runId);
}

/**
 * Closes the run and invalidates every cached view the catalogue feeds.
 *
 * The storefront paths matter as much as the admin ones: an import that adds
 * 494 active products has changed the home page and every collection, and
 * without this they would keep serving the pre-import render.
 */
export async function finishImport(
  runId: string,
  totals: ImportTotals,
  failed: boolean
) {
  const supabase = await createClient();

  await supabase
    .from("product_imports")
    .update({
      status: failed ? "failed" : "completed",
      created: totals.created,
      updated: totals.updated,
      skipped: totals.skipped,
      failed: totals.failed,
      errors: totals.errors.slice(0, 50),
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  revalidatePath("/admin/products");
  revalidatePath("/admin/products/inventory");
  revalidatePath("/admin/products/collections");
  revalidatePath("/");
  // The route patterns, not concrete paths: an import touches hundreds of
  // handles, and naming them one at a time would be both slower and wrong the
  // moment a product is renamed.
  revalidatePath("/products/[id]", "page");
  revalidatePath("/collections/[handle]", "page");
}
