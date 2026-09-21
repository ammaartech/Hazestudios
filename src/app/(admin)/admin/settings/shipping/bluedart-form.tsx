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
import type { BlueDartStatus } from "@/lib/couriers/config";
import { COURIERS } from "@/lib/couriers/providers";
import { saveBlueDartSettings, testBlueDart } from "./actions";

export function BlueDartForm({ status }: { status: BlueDartStatus }) {
  const [pending, startTransition] = useTransition();
  const [testing, startTesting] = useTransition();

  const [environment, setEnvironment] = useState(status.environment);
  const [clientId, setClientId] = useState(status.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [licenceKey, setLicenceKey] = useState("");
  const [trackingLicenceKey, setTrackingLicenceKey] = useState("");
  const [loginId, setLoginId] = useState(status.loginId);
  const [customerCode, setCustomerCode] = useState(status.customerCode);
  const [originArea, setOriginArea] = useState(status.originArea);
  const [apiType, setApiType] = useState(status.apiType);
  const [defaultService, setDefaultService] = useState(status.defaultService);
  const [registerPickup, setRegisterPickup] = useState(status.registerPickup);
  const [pickupTime, setPickupTime] = useState(status.pickupTime);
  const [enabled, setEnabled] = useState(status.enabled);

  function handleSave() {
    startTransition(async () => {
      const result = await saveBlueDartSettings({
        environment, clientId, clientSecret, licenceKey, trackingLicenceKey, loginId, customerCode, originArea, apiType,
        defaultService, registerPickup, pickupTime, enabled,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setClientSecret("");
      setLicenceKey("");
      setTrackingLicenceKey("");
      toast.success(result.message ?? "Saved");
    });
  }

  function handleTest() {
    startTesting(async () => {
      const result = await testBlueDart();
      if (result.ok) toast.success(result.message ?? "Connected");
      else toast.error(result.error);
    });
  }

  return (
    <Card id="bluedart">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Blue Dart</CardTitle>
        <Badge variant={status.configured && status.enabled ? "default" : "secondary"}>
          {status.configured && status.enabled ? "Connected" : status.configured ? "Configured, off" : "Not connected"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Blue Dart&rsquo;s API lives on the DHL developer portal. Two sets of credentials are needed: the{" "}
          <span className="font-medium text-foreground">consumer key and secret</span> of the app you register there, and the{" "}
          <span className="font-medium text-foreground">login ID, licence key and customer code</span> your Blue Dart account manager
          issues for the shipping API.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="bd-env">Environment</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as BlueDartStatus["environment"])}>
              <SelectTrigger id="bd-env">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox — testing</SelectItem>
                <SelectItem value="live">Live — real waybills</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {environment === "sandbox" ? "apigateway-sandbox.bluedart.com. Waybills here are not real." : "apigateway.bluedart.com. Waybills here are billed and picked up."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bd-client-id">Consumer key (ClientID)</Label>
            <Input id="bd-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="bd-secret">Consumer secret</Label>
            <Input
              id="bd-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={status.hasClientSecret ? "•••••••••••••••• — leave blank to keep" : "Paste the consumer secret"}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bd-licence">Licence key (shipping)</Label>
            <Input
              id="bd-licence"
              type="password"
              value={licenceKey}
              onChange={(e) => setLicenceKey(e.target.value)}
              placeholder={status.hasLicenceKey ? "•••••••••••••••• — leave blank to keep" : "Paste the licence key"}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="bd-login">Login ID</Label>
            <Input id="bd-login" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="off" placeholder="BOM12345" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bd-customer">Customer code</Label>
            <Input id="bd-customer" value={customerCode} onChange={(e) => setCustomerCode(e.target.value)} autoComplete="off" placeholder="099960" maxLength={10} />
            <p className="text-xs text-muted-foreground">The billing account, 6 characters.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bd-origin">Origin area</Label>
            <Input id="bd-origin" value={originArea} onChange={(e) => setOriginArea(e.target.value.toUpperCase())} autoComplete="off" placeholder="BOM" maxLength={3} />
            <p className="text-xs text-muted-foreground">Their 3-letter code for the pickup pincode&rsquo;s region. A mismatch is refused at booking.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="bd-service">Default service</Label>
            <Select value={defaultService} onValueChange={setDefaultService}>
              <SelectTrigger id="bd-service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COURIERS.bluedart.services.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.label} ({s.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Which product codes your contract allows is Blue Dart&rsquo;s call.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bd-pickup-time">Pickup by (HHMM)</Label>
            <Input id="bd-pickup-time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} inputMode="numeric" maxLength={4} placeholder="1600" />
            <p className="text-xs text-muted-foreground">Bookings after this time are dated for the next day.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bd-api-type">API type</Label>
            <Input id="bd-api-type" value={apiType} onChange={(e) => setApiType(e.target.value.toUpperCase())} maxLength={1} placeholder="S" />
            <p className="text-xs text-muted-foreground">Sent as Profile.Api_type. Leave as S unless Blue Dart says otherwise.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bd-tracking-licence">Tracking licence key (optional)</Label>
          <Input
            id="bd-tracking-licence"
            type="password"
            value={trackingLicenceKey}
            onChange={(e) => setTrackingLicenceKey(e.target.value)}
            placeholder={status.hasTrackingLicenceKey ? "•••••••••••••••• — leave blank to keep" : "Only if Blue Dart issued a separate key for tracking"}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">
            Some accounts get one licence key per API. If status refreshes fail with a licence error, this is the key they mean.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-0.5">
              <Label htmlFor="bd-register-pickup">Register a pickup with each waybill</Label>
              <p className="text-xs text-muted-foreground">
                Asks Blue Dart to schedule collection when the waybill is generated. Leave off if you have a standing daily pickup.
              </p>
            </div>
            <Switch id="bd-register-pickup" checked={registerPickup} onCheckedChange={setRegisterPickup} />
          </div>
          <div className="flex items-start justify-between gap-6 border-t pt-3">
            <div className="space-y-0.5">
              <Label htmlFor="bd-enabled">Enable Blue Dart</Label>
              <p className="text-xs text-muted-foreground">Off hides it from Ship now and stops every call.</p>
            </div>
            <Switch id="bd-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
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
            href="https://developer.dhl.com/api-reference/blue-dart-waybill"
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
          >
            Blue Dart API docs
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
