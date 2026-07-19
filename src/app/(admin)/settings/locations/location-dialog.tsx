"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Location } from "@/lib/types";
import { deleteLocation, saveLocation } from "../actions";

export function LocationDialog({ location }: { location?: Location }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(location?.name ?? "");
  const [address1, setAddress1] = useState(location?.address?.address1 ?? "");
  const [city, setCity] = useState(location?.address?.city ?? "");
  const [country, setCountry] = useState(location?.address?.country ?? "");
  const [isDefault, setIsDefault] = useState(location?.is_default ?? false);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await saveLocation({
        id: location?.id,
        name,
        address: { address1, city, country },
        is_default: isDefault,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(location ? "Location updated" : "Location added");
      setOpen(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!location) return;
    if (!window.confirm("Delete this location?")) return;
    startTransition(async () => {
      const result = await deleteLocation(location.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Location deleted");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {location ? (
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        ) : (
          <Button>Add location</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{location ? "Edit location" : "Add location"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="loc-name">Name</Label>
            <Input
              id="loc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Downtown store"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="loc-address">Address</Label>
            <Input
              id="loc-address"
              value={address1}
              onChange={(e) => setAddress1(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="loc-city">City</Label>
              <Input
                id="loc-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc-country">Country</Label>
              <Input
                id="loc-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={isDefault}
              onCheckedChange={(v) => setIsDefault(Boolean(v))}
              disabled={location?.is_default}
            />
            Default location (used for order stock adjustments)
          </label>
          <div className="flex gap-2">
            {location && !location.is_default && (
              <Button
                variant="outline"
                onClick={handleDelete}
                disabled={pending}
                className="text-destructive hover:text-destructive"
              >
                Delete
              </Button>
            )}
            <Button
              onClick={handleSave}
              disabled={pending || !name.trim()}
              className="flex-1"
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
