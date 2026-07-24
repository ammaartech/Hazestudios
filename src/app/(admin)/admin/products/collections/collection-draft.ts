import type {
  Collection,
  CollectionRule,
  CollectionSort,
  CollectionType,
} from "@/lib/types";

/**
 * The collection editor's draft shape, and the server-side factory that builds
 * it.
 *
 * Deliberately NOT a "use client" module. The pages that render the editor are
 * Server Components and call `draftFromCollection` while assembling props — and
 * a plain function exported from a client module cannot be invoked from the
 * server, only rendered as a component. Keeping the shape here and the store
 * next door in `collection-store.tsx` is what lets both sides import it.
 *
 * `rules` carries a client-only `key` because a rule has no id until it is
 * saved, and React needs a stable identity to keep the two select boxes from
 * being reused across rows as the list is edited.
 */
export interface RuleDraft extends CollectionRule {
  key: string;
}

export interface CollectionDraft extends Record<string, unknown> {
  id?: string;
  title: string;
  handle: string;
  description: string;
  type: CollectionType;
  rules: RuleDraft[];
  /** Ordered. The index is the manual position saved to product_collections. */
  product_ids: string[];
  image_url: string | null;
  seo_title: string;
  seo_description: string;
  sort_order: CollectionSort;
  published: boolean;
}

export function draftFromCollection(
  collection: Collection | null,
  productIds: string[]
): CollectionDraft {
  if (!collection) {
    return {
      title: "",
      handle: "",
      description: "",
      type: "manual",
      rules: [],
      product_ids: [],
      image_url: null,
      seo_title: "",
      seo_description: "",
      sort_order: "manual",
      // A new collection starts hidden. Publishing is a deliberate act — a
      // half-built drop appearing in the storefront nav the instant it is named
      // is the failure mode this avoids.
      published: false,
    };
  }

  return {
    id: collection.id,
    title: collection.title,
    handle: collection.handle,
    description: collection.description,
    type: collection.type,
    // Generated server-side and serialised into the client's initial props, so
    // both sides see the same keys and hydration stays stable.
    rules: collection.rules.map((r) => ({ ...r, key: crypto.randomUUID() })),
    product_ids: productIds,
    image_url: collection.image_url,
    seo_title: collection.seo_title,
    seo_description: collection.seo_description,
    sort_order: collection.sort_order,
    published: Boolean(collection.published_at),
  };
}
