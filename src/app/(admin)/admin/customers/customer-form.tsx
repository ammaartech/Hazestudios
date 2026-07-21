"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TagsInput } from "@/components/admin/tags-input";
import { saveCustomer, deleteCustomer, type CustomerPayload } from "./actions";

export function CustomerForm({ initial }: { initial: CustomerPayload }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [firstName, setFirstName] = useState(initial.first_name);
  const [lastName, setLastName] = useState(initial.last_name);
  const [email, setEmail] = useState(initial.email);
  const [phone, setPhone] = useState(initial.phone);
  const [notes, setNotes] = useState(initial.notes);
  const [tags, setTags] = useState(initial.tags);
  const [acceptsMarketing, setAcceptsMarketing] = useState(
    initial.accepts_marketing
  );
  const [address, setAddress] = useState(initial.default_address);

  function updateAddress(key: string, value: string) {
    setAddress((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveCustomer({
        id: initial.id,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        notes,
        tags,
        accepts_marketing: acceptsMarketing,
        default_address: address,
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(initial.id ? "Customer updated" : "Customer created");
      router.push("/customers");
      router.refresh();
    });
  }

  function handleDelete() {
    if (!initial.id) return;
    if (!window.confirm("Delete this customer?")) return;
    startTransition(async () => {
      const result = await deleteCustomer(initial.id!);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Customer deleted");
      router.push("/customers");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="first-name">First name</Label>
                <Input
                  id="first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last-name">Last name</Label>
                <Input
                  id="last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="marketing"
                checked={acceptsMarketing}
                onCheckedChange={setAcceptsMarketing}
              />
              <Label htmlFor="marketing">Customer accepts email marketing</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Default address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="address1">Address</Label>
              <Input
                id="address1"
                value={address.address1 ?? ""}
                onChange={(e) => updateAddress("address1", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={address.city ?? ""}
                onChange={(e) => updateAddress("city", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="province">Province / State</Label>
              <Input
                id="province"
                value={address.province ?? ""}
                onChange={(e) => updateAddress("province", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postal">Postal / ZIP code</Label>
              <Input
                id="postal"
                value={address.zip ?? ""}
                onChange={(e) => updateAddress("zip", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={address.country ?? ""}
                onChange={(e) => updateAddress("country", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              aria-label="Customer notes"
              placeholder="Notes are private and won't be shared with the customer."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <TagsInput value={tags} onChange={setTags} />
          </CardContent>
        </Card>

        <div className="flex gap-2">
          {initial.id && (
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={pending}
              className="text-destructive hover:text-destructive"
            >
              Delete
            </Button>
          )}
          <Button onClick={handleSave} disabled={pending} className="flex-1">
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
