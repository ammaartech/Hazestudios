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
import { createClient } from "@/lib/supabase/server";
import type { Location } from "@/lib/types";
import { DesktopTable } from "@/components/admin/record-list";
import { LocationDialog } from "./location-dialog";

export const metadata = { title: "Locations" };
export default async function LocationsSettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("*")
    .order("created_at");
  const locations = (data ?? []) as Location[];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Locations</CardTitle>
        <LocationDialog />
      </CardHeader>
      <CardContent>
        {/* The address column plus the Edit control put this row past a phone
            screen; stacked, the address gets a full line to itself. */}
        <ul className="-mx-2 divide-y md:hidden">
          {locations.map((loc) => (
            <li
              key={loc.id}
              className="flex items-center justify-between gap-3 px-2 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-foreground">
                  {loc.name}
                  {loc.is_default && (
                    <Badge variant="secondary" className="ml-2">
                      Default
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {[loc.address?.address1, loc.address?.city, loc.address?.country]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </p>
              </div>
              <div className="shrink-0">
                <LocationDialog location={loc} />
              </div>
            </li>
          ))}
        </ul>

        <DesktopTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {locations.map((loc) => (
              <TableRow key={loc.id}>
                <TableCell>
                  <span className="font-medium">{loc.name}</span>
                  {loc.is_default && (
                    <Badge variant="secondary" className="ml-2">
                      Default
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {[loc.address?.address1, loc.address?.city, loc.address?.country]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </TableCell>
                <TableCell>
                  <LocationDialog location={loc} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </DesktopTable>
      </CardContent>
    </Card>
  );
}
