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
import type { DtdcStatus } from "@/lib/couriers/config";
import { COURIERS } from "@/lib/couriers/providers";
import { saveDtdcSettings, testDtdc } from "./actions";

export function DtdcForm({ status }: { status: DtdcStatus }) {
  const [pending, startTransition] = useTransition();
  const [testing, startTesting] = useTransition();

  const [environment, setEnvironment] = useState(status.environment);
  const [apiKey, setApiKey] = useState("");
  const [customerCode, setCustomerCode] = useState(status.customerCode);
  const [defaultService, setDefaultService] = useState(status.defaultService);
  const [commodityId, setCommodityId] = useState(status.commodityId);
  const [codCollectionMode, setCodCollectionMode] = useState(status.codCollectionMode);
  const [trackingUsername, setTrackingUsername] = useState(status.trackingUsername);
  const [trackingSecret, setTrackingSecret] = useState("");
  const [enabled, setEnabled] = useState(status.enabled);

  function handleSave() {
    startTransition(async () => {
      const result = await saveDtdcSettings({
        environment, apiKey, customerCode, defaultService, commodityId, codCollectionMode, trackingUsername, trackingSecret, enabled,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setApiKey("");
      setTrackingSecret("");
      toast.success(result.message ?? "Saved");
    });
  }

  function handleTest() {
    startTesting(async () => {
      const result = await testDtdc();
      if (result.ok) toast.success(result.message ?? "Connected");
      else toast.error(result.error);
    });
  }

  return (
    <Card id="dtdc">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">DTDC</CardTitle>
        <Badge variant={status.configured && status.enabled ? "default" : "secondary"}>
          {status.configured && status.enabled ? "Connected" : status.configured ? "Configured, off" : "Not connected"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          DTDC&rsquo;s bookings run on their customer integration API (Shipsy). Your account manager issues the{" "}
          <span className="font-medium text-foreground">API key</span> and{" "}
          <span className="font-medium text-foreground">customer code</span>. Tracking is a separate DTDC system with its own
          login — optional, but without it the order page cannot refresh a parcel&rsquo;s status.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dt-env">Environment</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as DtdcStatus["environment"])}>
              <SelectTrigger id="dt-env">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Demo — testing</SelectItem>
                <SelectItem value="live">Live — real consignments</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {environment === "sandbox" ? "demodashboardapi.shipsy.in. Nothing here is picked up." : "dtdcapi.shipsy.io. Consignments here are real parcels."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dt-customer">Customer code</Label>
            <Input id="dt-customer" value={customerCode} onChange={(e) => setCustomerCode(e.target.value.toUpperCase())} autoComplete="off" placeholder="GL112" />
            <p className="text-xs text-muted-foreground">The billing account, sent on every consignment.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dt-key">API key</Label>
          <Input
            id="dt-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status.hasApiKey ? "•••••••••••••••• — leave blank to keep" : "Paste the API key"}
            autoComplete="new-password"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="dt-service">Default service</Label>
            <Select value={defaultService} onValueChange={setDefaultService}>
              <SelectTrigger id="dt-service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COURIERS.dtdc.services.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Pre-selected in Ship now; which ones your contract allows is DTDC&rsquo;s call.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dt-commodity">Commodity ID</Label>
            <Input id="dt-commodity" value={commodityId} onChange={(e) => setCommodityId(e.target.value)} inputMode="numeric" placeholder="99" />
            <p className="text-xs text-muted-foreground">From their commodity master. 99 is &ldquo;Others&rdquo;.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dt-cod-mode">COD collection mode</Label>
            <Input id="dt-cod-mode" value={codCollectionMode} onChange={(e) => setCodCollectionMode(e.target.value)} placeholder="cash" />
            <p className="text-xs text-muted-foreground">Sent on COD consignments. Leave as cash unless told otherwise.</p>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Tracking API (optional)</p>
            <p className="text-xs text-muted-foreground">
              A separate login DTDC issues for their tracking service. Enter the username and password, or leave the username blank
              and paste the access token they gave you instead.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dt-track-user">Tracking username</Label>
              <Input id="dt-track-user" value={trackingUsername} onChange={(e) => setTrackingUsername(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dt-track-secret">{trackingUsername ? "Tracking password" : "Access token"}</Label>
              <Input
                id="dt-track-secret"
                type="password"
                value={trackingSecret}
                onChange={(e) => setTrackingSecret(e.target.value)}
                placeholder={status.hasTrackingSecret ? "•••••••••••••••• — leave blank to keep" : trackingUsername ? "Password" : "Paste the token"}
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>

        <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="dt-enabled">Enable DTDC</Label>
            <p className="text-xs text-muted-foreground">Off hides it from Ship now and stops every call.</p>
          </div>
          <Switch id="dt-enabled" checked={enabled} onCheckedChange={setEnabled} />
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
            href="https://www.dtdc.in/integrated-e-commerce-logistics.asp"
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
          >
            DTDC e-commerce
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
