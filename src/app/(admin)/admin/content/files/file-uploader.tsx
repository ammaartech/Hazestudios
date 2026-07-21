"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { recordFile } from "./actions";

export function FileUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList) {
    setUploading(true);
    const supabase = createClient();

    for (const file of Array.from(files)) {
      const path = `${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error } = await supabase.storage.from("files").upload(path, file);
      if (error) {
        toast.error(`Upload failed for ${file.name}: ${error.message}`);
        continue;
      }
      const { data } = supabase.storage.from("files").getPublicUrl(path);
      const result = await recordFile({
        url: data.publicUrl,
        filename: file.name,
        mime_type: file.type,
        size: file.size,
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
