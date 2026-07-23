"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { useField } from "@/lib/form-store";
import { useProductStore } from "../product-draft";
import { Field } from "./fields";

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
