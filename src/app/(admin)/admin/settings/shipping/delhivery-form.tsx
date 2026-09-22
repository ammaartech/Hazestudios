"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DelhiveryStatus } from "@/lib/couriers/config";
import { saveDelhiverySettings, testDelhivery } from "./actions";

export function DelhiveryForm({ status }: { status: DelhiveryStatus }) {
  const [pending, startTransition] = useTransition();
  const [testing, startTesting] = useTransition();

  const [environment, setEnvironment] = useState(status.environment);
  const [token, setToken] = useState("");
  const [pickupLocation, setPickupLocation] = useState(status.pickupLocation);
  const [defaultService, setDefaultService] = useState(status.defaultService);
  const [sellerGstin, setSellerGstin] = useState(status.sellerGstin);
  const [enabled, setEnabled] = useState(status.enabled);

  function handleSave() {
    startTransition(async () => {
      const result = await saveDelhiverySettings({ environment, token, pickupLocation, defaultService, sellerGstin, enabled });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setToken("");
      toast.success(result.message ?? "Saved");
    });
  }

  function handleTest() {
    startTesting(async () => {
      const result = await testDelhivery();
      if (result.ok) toast.success(result.message ?? "Connected");
      else toast.error(result.error);
    });
  }

  return (
    <Card id="delhivery">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Delhivery</CardTitle>
        <Badge variant={status.configured && status.enabled ? "default" : "secondary"}>
          {status.configured && status.enabled ? "Connected" : status.configured ? "Configured, off" : "Not connected"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          One API token from Delhivery One (Settings → API setup) does everything. Delhivery only collects from a{" "}
          <span className="font-medium text-foreground">warehouse registered on the account</span>, so the pickup location
          below is that warehouse&rsquo;s name exactly as registered — not the address from the pickup profile above.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dl-env">Environment</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as DelhiveryStatus["environment"])}>
              <SelectTrigger id="dl-env">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Staging — testing</SelectItem>
                <SelectItem value="live">Live — real waybills</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {environment === "sandbox"
                ? "staging-express.delhivery.com, with the staging token from the client developer portal."
                : "track.delhivery.com. Waybills here are billed and picked up."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dl-token">API token</Label>
            <Input
              id="dl-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={status.hasToken ? "•••••••••••••••• — leave blank to keep" : "Paste the token"}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">Differs between staging and live.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="dl-pickup">Pickup location (registered warehouse name)</Label>
            <Input id="dl-pickup" value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} autoComplete="off" placeholder="Haze Studios Mumbai" />
            <p className="text-xs text-muted-foreground">
              Case- and space-sensitive: it must match the name in Delhivery One → Warehouses letter for letter.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dl-service">Default service</Label>
            <Select value={defaultService} onValueChange={(v) => setDefaultService(v as "Surface" | "Express")}>
              <SelectTrigger id="dl-service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Surface">Surface</SelectItem>
                <SelectItem value="Express">Express</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Pre-selected in Ship now.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dl-gstin">Seller GSTIN (optional)</Label>
          <Input id="dl-gstin" value={sellerGstin} onChange={(e) => setSellerGstin(e.target.value.toUpperCase())} maxLength={15} placeholder="27ABCDE1234F1Z5" autoComplete="off" />
          <p className="text-xs text-muted-foreground">
            Sent on every manifest. Leave blank if your account manager has already put it on the account.
          </p>
        </div>

        <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="dl-enabled">Enable Delhivery</Label>
            <p className="text-xs text-muted-foreground">Off hides it from Ship now and stops every call.</p>
          </div>
          <Switch id="dl-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing || !(status.configured && status.enabled)}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {!(status.configured && status.enabled) && <span className="text-xs text-muted-foreground">Save and enable first</span>}
          <a
            href="https://one.delhivery.com/developer-portal/documents"
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
          >
            Delhivery API docs
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
