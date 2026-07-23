"use client";

import { useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaUploader, type DraftImage } from "@/components/admin/media-uploader";
import { useField } from "@/lib/form-store";
import { useProductStore } from "../product-draft";

export function MediaSection() {
  const store = useProductStore();
  const [images] = useField(store, "images");

  // Functional update: uploads resolve out of order, so each one must apply to
  // whatever the list is at that moment rather than to a captured snapshot.
  const update = useCallback(
    (fn: (prev: DraftImage[]) => DraftImage[]) => store.update("images", fn),
    [store]
  );

  return (
    <Card id="section-media" className="scroll-mt-32">
      <CardHeader>
        <CardTitle className="text-base">Media</CardTitle>
      </CardHeader>
      <CardContent>
        <MediaUploader images={images} update={update} />
      </CardContent>
    </Card>
  );
}
