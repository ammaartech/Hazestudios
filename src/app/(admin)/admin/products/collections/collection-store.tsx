"use client";

import { createContext, useContext, useState } from "react";
import { FormStore } from "@/lib/form-store";
import type { CollectionDraft } from "./collection-draft";

/**
 * The collection editor's store.
 *
 * Same solution as the product editor: a field-granular store rather than one
 * `useState` object, so typing a description does not re-render the member list
 * or re-evaluate the smart-rule preview on every keystroke.
 *
 * Split from `collection-draft.ts` because that module's factory has to be
 * callable from a Server Component, and a "use client" module's plain function
 * exports are not.
 */
export type CollectionStore = FormStore<CollectionDraft>;

const StoreContext = createContext<CollectionStore | null>(null);

export function CollectionDraftProvider({
  initial,
  children,
}: {
  initial: CollectionDraft;
  children: React.ReactNode;
}) {
  // Created once per mount, deliberately ignoring later `initial` identities: a
  // router.refresh() after save hands down a structurally-equal but new object,
  // and rebuilding here would discard in-progress edits. Switching between two
  // collections is handled by `key` at the call site.
  const [store] = useState(() => new FormStore<CollectionDraft>(initial));
  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}

export function useCollectionStore(): CollectionStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error(
      "useCollectionStore must be used inside <CollectionDraftProvider>"
    );
  }
  return store;
}
