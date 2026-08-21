import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  CollectionTuple,
  ProductTuple,
  SearchIndexPayload,
} from "@/lib/search/types";

/**
 * The catalogue, as one payload the admin search matches against in the browser.
 *
 * Shipping the whole product list to the client is the unusual decision here, so
 * it is worth stating the numbers it rests on: 849 products and 33 collections
 * are 189 KB of JSON, 55 KB over the wire compressed. That is one medium
 * photograph, fetched at most once per session — and in exchange every keystroke
 * ranks the entire catalogue in about three milliseconds with no network at all.
 *
 * The alternative is a request per keystroke. Even debounced, that is a round
 * trip to ap-south-1 before anything appears, which is the difference between a
 * search that feels like a local index and one that feels like a website. And
 * the debounce is not free either: it is the delay you feel most, because it
 * lands exactly when you have stopped typing and are waiting.
 *
 * The line this sits on is cardinality, not principle. Orders (6,772) and
 * customers (3,974) are on the far side of it and stay in Postgres behind
 * `admin_search` — see `search-remote.ts`. If the catalogue ever grows past a
 * few thousand products this endpoint should move across that line too; the
 * dropdown merges both tiers identically, so that change would be local to
 * these two files.
 *
 * Deliberately *not* `use cache`. The payload is small, but it is per-store
 * operational data behind an auth check, and caching it on the server would put
 * one merchant's catalogue in a shared cache keyed on nothing. The browser's own
 * cache is the right place for it, which is what the `private` directive below
 * asks for.
 */

/** Archived products are excluded — see the note on the query. */
const INDEXABLE_STATUSES = ["active", "draft"];

export async function GET() {
  const supabase = await createClient();

  // The admin's RLS policies are `to authenticated`, so an anonymous request
  // would come back empty rather than forbidden. Checking explicitly means the
  // client can tell "logged out" from "no products", which are very different
  // things to show in a dropdown.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [{ data: products, error: productError }, { data: collections, error: collectionError }] =
    await Promise.all([
      supabase
        .from("products")
        // The cover is the lowest-position image. Fetched as a nested list and
        // reduced below rather than with a lateral join, because PostgREST has
        // no way to express "one row per parent" on an embedded resource.
        .select("id, title, vendor, product_type, tags, sku, status, product_images(url, position)")
        // Archived products are the one category left out. They are not part of
        // the working catalogue, there are enough of them to pad the payload,
        // and the fallback row at the bottom of the dropdown ("Search all
        // products") reaches them through the SQL-backed list page. Draft
        // products stay: a half-written product is exactly the kind of thing
        // someone opens search to get back to.
        .in("status", INDEXABLE_STATUSES)
        .order("updated_at", { ascending: false }),
      supabase
        .from("collections")
        .select("id, title, handle, type, image_url, product_collections(count)")
        .order("title"),
    ]);

  if (productError || collectionError) {
    return NextResponse.json(
      { error: (productError ?? collectionError)?.message ?? "Search index unavailable" },
      { status: 500 }
    );
  }

  type ProductRow = {
    id: string;
    title: string;
    vendor: string | null;
    product_type: string | null;
    tags: string[] | null;
    sku: string | null;
    status: string;
    product_images: { url: string; position: number }[] | null;
  };

  type CollectionRow = {
    id: string;
    title: string;
    handle: string;
    type: string;
    image_url: string | null;
    product_collections: { count: number }[] | null;
  };

  const payload: SearchIndexPayload = {
    // Tuples, not objects: see the note on `ProductTuple`. Eight repeated key
    // names across 849 rows is most of what the compressor would otherwise be
    // asked to undo.
    products: ((products ?? []) as ProductRow[]).map((p): ProductTuple => {
      let cover: string | null = null;
      let coverPosition = Infinity;
      for (const image of p.product_images ?? []) {
        if (image.position < coverPosition) {
          coverPosition = image.position;
          cover = image.url;
        }
      }
      return [
        p.id,
        p.title,
        p.vendor ?? "",
        p.product_type ?? "",
        p.tags ?? [],
        p.sku ?? "",
        p.status,
        cover,
      ];
    }),
    collections: ((collections ?? []) as CollectionRow[]).map(
      (c): CollectionTuple => [
        c.id,
        c.title,
        c.handle,
        c.type,
        c.image_url,
        c.product_collections?.[0]?.count ?? 0,
      ]
    ),
    builtAt: Date.now(),
  };

  return NextResponse.json(payload, {
    headers: {
      // `private` keeps this out of any shared cache — it is one merchant's
      // catalogue behind a session. `max-age=120` covers the common case of a
      // hard refresh or a second admin tab without a second round trip;
      // `stale-while-revalidate` lets a returning tab paint from the old index
      // immediately while a fresh one is fetched underneath, so search is never
      // unavailable while it updates.
      "Cache-Control": "private, max-age=120, stale-while-revalidate=600",
    },
  });
}
