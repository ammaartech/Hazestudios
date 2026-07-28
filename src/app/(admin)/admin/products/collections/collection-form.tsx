"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/admin/page-header";
import { SaveBar } from "@/components/admin/save-bar";
import { useField, useIsDirty } from "@/lib/form-store";
import { deleteCollection, saveCollection, type CollectionPayload } from "./actions";
import type { CollectionDraft } from "./collection-draft";
import { CollectionDraftProvider, useCollectionStore } from "./collection-store";
import { CollectionItems, type PickerProduct } from "./collection-items";
import {
  DetailsSection,
  ImageSection,
  SeoSection,
  TypeSection,
  VisibilitySection,
} from "./collection-sections";

export interface CollectionFormProps {
  initial: CollectionDraft;
  products: PickerProduct[];
  storeUrl?: string;
}

export function CollectionForm(props: CollectionFormProps) {
  return (
    <CollectionDraftProvider initial={props.initial}>
      <CollectionFormInner {...props} />
    </CollectionDraftProvider>
  );
}

function CollectionFormInner({
  products,
  storeUrl = "fogstores.com",
}: Omit<CollectionFormProps, "initial">) {
  const router = useRouter();
  const store = useCollectionStore();
  const dirty = useIsDirty(store);
  const [saving, startSaving] = useTransition();

  const [id] = useField(store, "id");
  const [title] = useField(store, "title");
  const [handle] = useField(store, "handle");
  const [published] = useField(store, "published");

  const isNew = !id;
  const canSave = title.trim().length > 0;

  function handleSave() {
    const draft = store.snapshot();

    const payload: CollectionPayload = {
      id: draft.id,
      title: draft.title,
      handle: draft.handle,
      description: draft.description,
      type: draft.type,
      // Blank rules are UI scaffolding, not conditions — a saved empty rule
      // would match nothing and silently empty the collection.
      rules: draft.rules
        .filter((r) => r.value.trim())
        .map(({ key: _key, ...rest }) => rest),
      product_ids: draft.product_ids,
      image_url: draft.image_url,
      seo_title: draft.seo_title,
      seo_description: draft.seo_description,
      sort_order: draft.sort_order,
      published: draft.published,
    };

    startSaving(async () => {
      const result = await saveCollection(payload);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }

      // Commit the saved shape as the new clean baseline so the save bar
      // stands down. The handle comes back from the server because it may have
      // been de-duplicated, and adopting the local value would leave the form
      // dirty against a value that was never stored.
      store.commit({
        ...draft,
        id: result.id,
        handle: result.handle ?? draft.handle,
      });

      toast.success(isNew ? "Collection created" : "Collection updated");

      if (isNew && result.id) {
        router.replace(`/admin/products/collections/${result.id}`);
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (!id) return;
    if (
      !window.confirm(
        "Delete this collection? The products stay, but the grouping is gone for good."
      )
    ) {
      return;
    }
    startSaving(async () => {
      const result = await deleteCollection(id);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Collection deleted");
      router.push("/admin/products/collections");
      router.refresh();
    });
  }

  return (
    <div>
      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        onDiscard={() => store.reset()}
        disabled={!canSave}
        disabledReason={!canSave ? "Give the collection a title first." : undefined}
        saveLabel={isNew ? "Create" : "Save"}
      />

      <PageHeader
        title={title.trim() || (isNew ? "Add collection" : "Untitled collection")}
        backHref="/admin/products/collections"
        backLabel="Collections"
      >
        {!isNew && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem asChild disabled={!published}>
                <Link
                  href={`/collections/${handle}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-4" />
                  {published ? "View on storefront" : "Publish to view"}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
                <Trash2 className="size-4" />
                Delete collection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PageHeader>

      {/* Two columns on desktop: what the collection *is* on the left, how it
          behaves on the right — the same split the product editor uses. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="space-y-5">
          <DetailsSection />
          <CollectionItems products={products} />
          <SeoSection storeUrl={storeUrl} />
        </div>

        <div className="space-y-5">
          <VisibilitySection />
          <TypeSection />
          <ImageSection />
        </div>
      </div>
    </div>
  );
}
