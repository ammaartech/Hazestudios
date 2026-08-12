"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WAITLIST_STATUSES } from "@/lib/shop/waitlist";
import type { WaitlistStatus } from "@/lib/types";
import { updateWaitlistStatus } from "./actions";

/**
 * Per-row triage control.
 *
 * Optimistic by hand rather than with `useOptimistic`: the value has to survive
 * the revalidation the action triggers, and a `useOptimistic` state would snap
 * back to the server value in the gap between the action resolving and the new
 * page data arriving. On failure it is put back and the operator is told, so
 * the control never shows a state the database does not hold.
 */
export function StatusSelect({
  id,
  status,
}: {
  id: string;
  status: WaitlistStatus;
}) {
  const [value, setValue] = useState<WaitlistStatus>(status);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const previous = value;
    setValue(next as WaitlistStatus);

    startTransition(async () => {
      const result = await updateWaitlistStatus(id, next);
      if (result?.error) {
        setValue(previous);
        toast.error("Could not update status", { description: result.error });
      }
    });
  }

  return (
    <Select value={value} onValueChange={change} disabled={pending}>
      <SelectTrigger
        className="h-8 w-[130px] text-[13px]"
        aria-label="Waitlist status"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {WAITLIST_STATUSES.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
