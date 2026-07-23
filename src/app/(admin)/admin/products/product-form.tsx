"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Copy, ExternalLink, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SaveBar } from "@/components/admin/save-bar";
import { isUploading } from "@/components/admin/media-uploader";
import { useField, useFields, useIsDirty } from "@/lib/form-store";
import { handleize } from "@/lib/format";
import type { Collection, Location } from "@/lib/types";
import {
  deleteProduct,
  duplicateProduct,
  saveProduct,
  type ProductFacets,
} from "./actions";
import {
  ProductDraftProvider,
  toPayload,
  useProductStore,
  type ProductDraft,
} from "./product-draft";
import { BasicsSection } from "./sections/basics";
import { InventorySection } from "./sections/inventory";
import { MediaSection } from "./sections/media";
import { OrganizationSection } from "./sections/organization";
import { PricingSection } from "./sections/pricing";
import { SeoSection } from "./sections/seo";
import { ShippingSection } from "./sections/shipping";
import { StatusSection } from "./sections/status";
import { VariantsSection } from "./sections/variants";

export interface ProductFormProps {
  initial: ProductDraft;
  collections: Collection[];
  locations: Location[];
  facets: ProductFacets;
  currency?: string;
  storeUrl?: string;
}

export function ProductForm(props: ProductFormProps) {
  return (
    <ProductDraftProvider initial={props.initial}>
      <ProductFormInner {...props} />
    </ProductDraftProvider>
  );
}

function ProductFormInner({
  collections,
  locations,
  facets,
  currency = "USD",
  storeUrl = "hazestudios.com",
}: Omit<ProductFormProps, "initial">) {
  const router = useRouter();
  const store = useProductStore();
  const dirty = useIsDirty(store);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [duplicating, startDuplicating] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showTitleError, setShowTitleError] = useState(false);

  const [productId] = useField(store, "id");
  const header = useFields<ProductDraft, "title" | "status" | "handle" | "images">(
    store,
    ["title", "status", "handle", "images"]
  );

  const isNew = !productId;
  const titleMissing = !header.title.trim();
  const uploading = isUploading(header.images);

  const blockedReason = titleMissing
    ? "Add a title before saving."
    : uploading
      ? "Wait for images to finish uploading."
      : undefined;

  const handleSave = useCallback(() => {
    if (titleMissing) {
      setShowTitleError(true);
      document.getElementById("section-basics")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }
    if (uploading) {
      toast.error("Images are still uploading.");
      return;
    }

    const draft = store.snapshot();
    // Failed uploads have no Storage object behind them, so they must not be
    // written as image rows pointing at a URL that will 404. The transient
    // upload fields are dropped too — they are UI state, not record data.
    const cleaned: ProductDraft = {
      ...draft,
      images: draft.images
        .filter((i) => i.status !== "error")
        .map((i) => ({ id: i.id, url: i.url, alt: i.alt, status: "ready" as const })),
    };

    startSaving(async () => {
      const result = await saveProduct(toPayload(cleaned, locations));

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      // Adopt the server's id and handle as the new clean baseline, so the save
      // bar retracts and a second save updates rather than inserting again.
      store.commit({ ...cleaned, id: result.id, handle: result.handle });
      setShowTitleError(false);

      toast.success(isNew ? "Product created" : "Product saved", {
        action:
          store.get("status") === "active"
            ? {
                label: "View",
                onClick: () => window.open(`/products/${result.handle}`, "_blank"),
              }
            : undefined,
      });

      // Stay on the record instead of bouncing to the list — the operator
      // almost always has more to do here, and `replace` keeps Back meaningful.
      if (isNew) router.replace(`/admin/products/${result.id}`);
      else router.refresh();
    });
  }, [titleMissing, uploading, store, locations, isNew, router]);

  const handleDiscard = useCallback(() => {
    store.reset();
    setShowTitleError(false);
  }, [store]);

  function handleDuplicate() {
    if (!productId) return;
    startDuplicating(async () => {
      const result = await duplicateProduct(productId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Product duplicated");
      router.push(`/admin/products/${result.id}`);
    });
  }

  function handleDelete() {
    if (!productId) return;
    startDeleting(async () => {
      const result = await deleteProduct(productId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirmDelete(false);
      toast.success("Product deleted");
      router.push("/admin/products");
    });
  }

  const previewHandle = header.handle.trim() || handleize(header.title);

  return (
    <div className="pb-16">
      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
        disabled={Boolean(blockedReason)}
        disabledReason={blockedReason}
        message={
          uploading ? "Waiting for images to finish uploading…" : undefined
        }
      />

      <div className="mb-5">
        <Link
          href="/admin/products"
          className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Products
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 truncate text-xl font-bold tracking-tight">
            {isNew ? "Add product" : header.title || "Untitled product"}
          </h1>

          {!isNew && (
            <div className="flex items-center gap-2">
              {header.status === "active" && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`/products/${previewHandle}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="size-3.5" />
                    View on store
                  </a>
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label="More actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={handleDuplicate}
                    disabled={duplicating || dirty}
                    className="cursor-pointer"
                  >
                    <Copy className="size-4" />
                    {duplicating ? "Duplicating…" : "Duplicate"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setConfirmDelete(true)}
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {!isNew && dirty && (
          <p className="mt-1 text-xs text-muted-foreground">
            Duplicating is disabled until you save or discard your changes.
          </p>
        )}
      </div>

      {/* Source order matches the task: identify it, show it, price it, stock
          it, split it into variants, then tune how it is found. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <BasicsSection
            titleError={
              showTitleError && titleMissing ? "Title is required." : undefined
            }
          />
          <MediaSection />
          <PricingSection currency={currency} />
          <InventorySection locations={locations} />
          <ShippingSection />
          <VariantsSection locations={locations} currency={currency} />
          <SeoSection storeUrl={storeUrl} />
        </div>

        <div className="space-y-5 lg:sticky lg:top-28">
          <StatusSection />
          <OrganizationSection collections={collections} facets={facets} />
        </div>
      </div>

      {/* Bottom save is the familiar long-form affordance; the sticky bar is
          for when you are deep in the page. Both call the same handler. */}
      <div className="mt-6 flex items-center justify-end gap-2">
        {dirty && (
          <Button variant="outline" onClick={handleDiscard} disabled={saving}>
            Discard
          </Button>
        )}
        <Button
          onClick={handleSave}
          disabled={saving || Boolean(blockedReason)}
          title={blockedReason}
        >
          {saving ? "Saving…" : isNew ? "Save product" : "Save"}
        </Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {header.title || "this product"}?</DialogTitle>
            <DialogDescription>
              This permanently removes the product, its images, variants, and
              stock records. Past orders keep their own copy of the item, so
              order history is unaffected. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={deleting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
