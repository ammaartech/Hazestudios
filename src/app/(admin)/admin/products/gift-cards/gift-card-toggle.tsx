"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toggleGiftCard } from "./actions";

export function GiftCardToggle({
  id,
  disabled,
}: {
  id: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await toggleGiftCard(id, !disabled);
          if (result.error) toast.error(result.error);
          else router.refresh();
        })
      }
    >
      {disabled ? "Enable" : "Disable"}
    </Button>
  );
}
