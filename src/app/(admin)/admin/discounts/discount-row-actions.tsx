"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteDiscount, toggleDiscount } from "./actions";

export function DiscountRowActions({
  id,
  disabled,
}: {
  id: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await toggleDiscount(id, !disabled);
            if (result.error) toast.error(result.error);
            else router.refresh();
          })
        }
      >
        {disabled ? "Enable" : "Disable"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        className="text-destructive hover:text-destructive"
        onClick={() => {
          if (!window.confirm("Delete this discount?")) return;
          startTransition(async () => {
            const result = await deleteDiscount(id);
            if (result.error) toast.error(result.error);
            else router.refresh();
          });
        }}
      >
        Delete
      </Button>
    </div>
  );
}
