"use client";

import { useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Copy, FileIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { FileRecord } from "@/lib/types";
import { deleteFile } from "./actions";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileCard({ file }: { file: FileRecord }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isImage = file.mime_type.startsWith("image/");

  return (
    <Card className="overflow-hidden py-0">
      <div className="relative flex aspect-square items-center justify-center bg-muted">
        {isImage ? (
          <Image
            src={file.url}
            alt={file.filename}
            fill
            sizes="200px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <FileIcon className="size-10 text-muted-foreground" />
        )}
      </div>
      <CardContent className="space-y-1 p-3">
        <p className="truncate text-sm font-medium" title={file.filename}>
          {file.filename}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(file.size)} · {formatDate(file.created_at)}
        </p>
        <div className="flex gap-1 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => {
              navigator.clipboard.writeText(file.url);
              toast.success("URL copied");
            }}
          >
            <Copy className="size-3.5" />
            Copy URL
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`Delete ${file.filename}`}
            disabled={pending}
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (!window.confirm(`Delete ${file.filename}?`)) return;
              startTransition(async () => {
                const result = await deleteFile(file.id, file.url);
                if (result.error) toast.error(result.error);
                else router.refresh();
              });
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
