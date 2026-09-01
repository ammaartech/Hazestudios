"use client";

import dynamic from "next/dynamic";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useField } from "@/lib/form-store";
import { useProductStore } from "../product-draft";
import { Field } from "./fields";

/**
 * TipTap pulls ProseMirror in behind it — comfortably the largest thing on the
 * product page, and dead weight in the initial bundle for anyone who opens a
 * product to change its price. It already runs with `immediatelyRender: false`,
 * so the server renders nothing for it either way; splitting it out costs no
 * markup and takes the whole editor off the critical path.
 */
const RichTextEditor = dynamic(
  () =>
    import("@/components/admin/rich-text-editor").then((m) => m.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      // The editor's own frame — toolbar strip over a min-h-40 body — so the
      // field holds its height instead of jumping when the chunk lands.
      <div className="rounded-md border border-input bg-card">
        <div className="h-10 border-b border-input" />
        <div className="min-h-40" />
      </div>
    ),
  }
);

export function BasicsSection({ titleError }: { titleError?: string }) {
  const store = useProductStore();
  const [title, setTitle] = useField(store, "title");
  const [description, setDescription] = useField(store, "description_html");

  return (
    <Card id="section-basics" className="scroll-mt-32">
      <CardContent className="space-y-4">
        <Field
          label="Title"
          error={titleError}
          hint="What customers see first, in search results and on the product page."
        >
          {(props) => (
            <Input
              {...props}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short sleeve t-shirt"
              autoComplete="off"
            />
          )}
        </Field>

        <Field label="Description" optional>
          {({ id }) => (
            <div id={id}>
              <RichTextEditor value={description} onChange={setDescription} />
            </div>
          )}
        </Field>
      </CardContent>
    </Card>
  );
}
