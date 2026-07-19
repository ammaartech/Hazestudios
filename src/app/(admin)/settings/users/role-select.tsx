"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StaffRole } from "@/lib/types";
import { updateStaffRole } from "../actions";

export function RoleSelect({
  userId,
  role,
  disabled,
}: {
  userId: string;
  role: StaffRole;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={role}
      disabled={disabled || pending}
      onValueChange={(value) =>
        startTransition(async () => {
          const result = await updateStaffRole(userId, value as StaffRole);
          if (result.error) toast.error(result.error);
          else {
            toast.success("Role updated");
            router.refresh();
          }
        })
      }
    >
      <SelectTrigger className="w-32" aria-label="Staff role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="owner">Owner</SelectItem>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="staff">Staff</SelectItem>
      </SelectContent>
    </Select>
  );
}
