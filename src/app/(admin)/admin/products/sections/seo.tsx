"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { useFields } from "@/lib/form-store";
import { handleize } from "@/lib/format";
import { useProductStore, type ProductDraft } from "../product-draft";
import { CharCount, Field } from "./fields";

const TITLE_MAX = 70;
const DESC_MAX = 320;

const KEYS = ["title", "handle", "seo_title", "seo_description", "description_html"] as const;

/** Strip tags so the fallback preview shows prose, not markup. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function SeoSection({ storeUrl = "hazestudios.com" }: { storeUrl?: string }) {
  const store = useProductStore();
  const v = useFields<ProductDraft, (typeof KEYS)[number]>(store, KEYS);
  const [editingHandle, setEditingHandle] = useState(false);

  // Empty SEO fields inherit from the product, exactly as they will at render
  // time — so the preview shows what Google will actually see, not blanks.
  const effectiveHandle = v.handle.trim() || handleize(v.title) || "product-handle";
  const effectiveTitle = v.seo_title.trim() || v.title.trim() || "Product title";
  const effectiveDesc =
    v.seo_description.trim() || plainText(v.description_html).slice(0, DESC_MAX);

  return (
    <Card id="section-seo" className="scroll-mt-32">
      <CardHeader>
        <CardTitle className="text-base">Search engine listing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Preview first: it is the thing being edited, and seeing it change as
            you type is what makes the character limits meaningful. */}
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="truncate text-xs text-muted-foreground">
            {storeUrl}/products/{effectiveHandle}
          </p>
          <p className="mt-1 truncate text-base text-[#1a0dab] dark:text-[#8ab4f8]">
            {effectiveTitle}
          </p>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {effectiveDesc || "Add a description to control what appears here."}
          </p>
        </div>

        <Field
          label="Page title"
          optional
          hint={
            <span className="flex justify-between gap-2">
              <span>Defaults to the product title.</span>
              <CharCount value={v.seo_title} max={TITLE_MAX} />
            </span>
          }
        >
          {(props) => (
            <Input
              {...props}
              value={v.seo_title}
              onChange={(e) => store.set("seo_title", e.target.value)}
              placeholder={v.title || "Product title"}
            />
          )}
        </Field>

        <Field
          label="Meta description"
          optional
          hint={
            <span className="flex justify-between gap-2">
              <span>Defaults to the start of the description.</span>
              <CharCount value={v.seo_description} max={DESC_MAX} />
            </span>
          }
        >
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              value={v.seo_description}
              onChange={(e) => store.set("seo_description", e.target.value)}
              className="resize-y"
            />
          )}
        </Field>

        <Field
          label="URL handle"
          hint={
            editingHandle
              ? "Changing this breaks existing links to the product."
              : undefined
          }
        >
          {(props) =>
            editingHandle ? (
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <InputGroupText className="text-xs">/products/</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  {...props}
                  autoFocus
                  value={v.handle}
                  spellCheck={false}
                  onChange={(e) => store.set("handle", handleize(e.target.value))}
                  onBlur={() => setEditingHandle(false)}
                />
              </InputGroup>
            ) : (
              // Read-only until deliberately unlocked: the handle is a live URL,
              // and editing one by accident is a broken link nobody notices.
              <div className="flex items-center gap-2">
                <p
                  id={props.id}
                  className="min-w-0 flex-1 truncate rounded-lg border border-transparent bg-muted/40 px-2.5 py-1 text-sm text-muted-foreground"
                >
                  /products/{effectiveHandle}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    store.set("handle", effectiveHandle);
                    setEditingHandle(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
              </div>
            )
          }
        </Field>
      </CardContent>
    </Card>
  );
}
