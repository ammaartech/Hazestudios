import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import type { StaffMember } from "@/lib/types";
import { RoleSelect } from "./role-select";

export const metadata = { title: "Users and permissions" };
export const dynamic = "force-dynamic";

export default async function UsersSettingsPage() {
  const supabase = await createClient();
  const [{ data: staffData }, { data: userData }] = await Promise.all([
    supabase.from("staff_roles").select("*").order("created_at"),
    supabase.auth.getUser(),
  ]);

  const staff = (staffData ?? []) as StaffMember[];
  const currentUserId = userData.user?.id;
  const me = staff.find((s) => s.user_id === currentUserId);
  const canManage = me?.role === "owner" || me?.role === "admin";

  return (
    <div className="space-y-5">
      <Alert>
        <UserPlus className="size-4" />
        <AlertTitle>Inviting staff</AlertTitle>
        <AlertDescription>
          Ask a teammate to create an account on the login page — they join as
          Staff automatically, and you can adjust their role here. (The very
          first account becomes the Owner.)
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((s) => (
                <TableRow key={s.user_id}>
                  <TableCell>
                    <span className="font-medium">
                      {s.display_name ?? s.user_id.slice(0, 8)}
                    </span>
                    {s.user_id === currentUserId && (
                      <Badge variant="secondary" className="ml-2">
                        You
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(s.created_at)}
                  </TableCell>
                  <TableCell>
                    <RoleSelect
                      userId={s.user_id}
                      role={s.role}
                      disabled={!canManage || s.user_id === currentUserId}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
