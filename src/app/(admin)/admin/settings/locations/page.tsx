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
import { LocationDialog } from "./location-dialog";

export const metadata = { title: "Locations" };
export const dynamic = "force-dynamic";

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
      </CardContent>
    </Card>
  );
}
