"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { IMMUTABLE_CACHE_CONTROL, prepareImageUpload } from "@/lib/images/prepare-upload";
import { recordFile } from "./actions";

export function FileUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList) {
    setUploading(true);
    const supabase = createClient();

    for (const file of Array.from(files)) {
      // This bucket takes anything — PDFs, size guides, spreadsheets — and only
      // images come back conditioned. The rest pass straight through.
      const { file: upload } = await prepareImageUpload(file);
      const path = `${crypto.randomUUID()}-${upload.name.replace(/[^\w.\-]/g, "_")}`;
      const { error } = await supabase.storage
        .from("files")
        .upload(path, upload, { cacheControl: IMMUTABLE_CACHE_CONTROL });
      if (error) {
        toast.error(`Upload failed for ${file.name}: ${error.message}`);
        continue;
      }
      const { data } = supabase.storage.from("files").getPublicUrl(path);
      // Recorded from the conditioned file, so the library's listed type and
      // size describe the object that actually exists in the bucket.
      const result = await recordFile({
        url: data.publicUrl,
        filename: upload.name,
        mime_type: upload.type,
        size: upload.size,
      });
      if (result.error) toast.error(result.error);
    }

    setUploading(false);
    toast.success("Upload complete");
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
        {uploading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Upload className="size-4" />
        )}
        Upload files
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}
