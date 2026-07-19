"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteSegment } from "../actions";

export function SegmentDelete({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-destructive hover:text-destructive"
      onClick={() => {
        if (!window.confirm("Delete this segment?")) return;
        startTransition(async () => {
          const result = await deleteSegment(id);
          if ("error" in result && result.error) toast.error(result.error);
          else router.refresh();
        });
      }}
    >
      Delete
    </Button>
  );
}
