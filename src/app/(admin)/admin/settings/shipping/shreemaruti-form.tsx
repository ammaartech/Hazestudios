"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ShreeMarutiStatus } from "@/lib/couriers/config";
import { saveShreeMarutiSettings, testShreeMaruti } from "./actions";

export function ShreeMarutiForm({ status, webhookUrl }: { status: ShreeMarutiStatus; webhookUrl: string }) {
  const [pending, startTransition] = useTransition();
  const [testing, startTesting] = useTransition();

  const [environment, setEnvironment] = useState(status.environment);
  const [authMode, setAuthMode] = useState(status.authMode);
  // Secrets start blank whether or not one is stored: the stored value never
  // reaches this page. Blank on save means "keep what's there".
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState(status.username);
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState(status.tenantId);
  const [userId, setUserId] = useState(status.userId);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [defaultService, setDefaultService] = useState(status.defaultService);
  const [autoManifest, setAutoManifest] = useState(status.autoManifest);
  const [enabled, setEnabled] = useState(status.enabled);
  const [copied, setCopied] = useState(false);

  function handleSave() {
    startTransition(async () => {
      const result = await saveShreeMarutiSettings({
        environment, authMode, apiKey, username, password, tenantId, userId, webhookSecret, defaultService, autoManifest, enabled,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setApiKey("");
      setPassword("");
      setWebhookSecret("");
      toast.success(result.message ?? "Saved");
    });
  }

  function handleTest() {
    startTesting(async () => {
      const result = await testShreeMaruti();
      if (result.ok) toast.success(result.message ?? "Connected");
      else toast.error(result.error);
    });
  }

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <Card id="shreemaruti">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Shree Maruti</CardTitle>
        <Badge variant={status.configured && status.enabled ? "default" : "secondary"}>
          {status.configured && status.enabled ? "Connected" : status.configured ? "Configured, off" : "Not connected"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Shree Maruti&rsquo;s e-commerce bookings run on their InnoFulfill platform (SMILE). Credentials come from the InnoFulfill
          portal: either an API key from its settings page, or the email and password you sign in with.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sm-env">Environment</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as ShreeMarutiStatus["environment"])}>
              <SelectTrigger id="sm-env">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox — testing</SelectItem>
                <SelectItem value="live">Live — real bookings</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {environment === "sandbox" ? "sandbox.apis.innofulfill.com. Nothing here is picked up." : "apis.innofulfill.com. Bookings here are real parcels."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sm-auth">Sign in with</Label>
            <Select value={authMode} onValueChange={(v) => setAuthMode(v as ShreeMarutiStatus["authMode"])}>
              <SelectTrigger id="sm-auth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="api_key">API key</SelectItem>
                <SelectItem value="password">Email and password</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {authMode === "api_key"
                ? "Generated in the portal's settings. Labels also need the tenant and user IDs below."
                : "Logs in for a 24-hour token and learns the tenant and user IDs by itself."}
            </p>
          </div>
        </div>

        {authMode === "api_key" ? (
          <div className="space-y-2">
            <Label htmlFor="sm-key">API key</Label>
            <Input
              id="sm-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={status.hasApiKey ? "•••••••••••••••• — leave blank to keep" : "innofulfill_…"}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              Keys start with <code className="text-xs">innofulfill_</code> (or <code className="text-xs">prayog_</code> on older accounts) — their API rejects anything else before checking it.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sm-user">Login email</Label>
              <Input id="sm-user" type="email" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sm-pass">Password</Label>
              <Input
                id="sm-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={status.hasPassword ? "•••••••••••••••• — leave blank to keep" : "Password"}
                autoComplete="new-password"
              />
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sm-tenant">Tenant ID {authMode === "password" && <span className="text-muted-foreground">(optional)</span>}</Label>
            <Input id="sm-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} autoComplete="off" placeholder="69451272aaa4920b3afd5ba9" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sm-userid">User ID {authMode === "password" && <span className="text-muted-foreground">(optional)</span>}</Label>
            <Input id="sm-userid" value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="off" placeholder="d1134daa-c031-…" />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Their label endpoint wants both. With an API key they are copied from the portal; with a login they are read from the
            sign-in and these fields only override.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sm-service">Default service</Label>
            <Select value={defaultService} onValueChange={(v) => setDefaultService(v as "SURFACE" | "AIR")}>
              <SelectTrigger id="sm-service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SURFACE">Surface</SelectItem>
                <SelectItem value="AIR">Air</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Pre-selected in Ship now; changeable per order.</p>
          </div>
          <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="sm-manifest">Auto-manifest</Label>
              <p className="text-xs text-muted-foreground">Mark each booking ready for dispatch immediately, with no separate manifest step.</p>
            </div>
            <Switch id="sm-manifest" checked={autoManifest} onCheckedChange={setAutoManifest} />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Status webhook</p>
            <p className="text-xs text-muted-foreground">
              Optional. Register this URL in the InnoFulfill portal&rsquo;s webhook settings and paste the signing key it gives you, and
              delivery updates arrive as they happen instead of when someone presses Refresh.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input value={webhookUrl} readOnly className="font-mono text-xs" aria-label="Webhook URL" />
            <Button type="button" variant="outline" size="sm" onClick={copyWebhook} disabled={!webhookUrl} aria-label="Copy webhook URL">
              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sm-webhook-secret">Webhook signing key</Label>
            <Input
              id="sm-webhook-secret"
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={status.hasWebhookSecret ? "•••••••••••••••• — leave blank to keep" : "Paste the signing key"}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="sm-enabled">Enable Shree Maruti</Label>
            <p className="text-xs text-muted-foreground">Off hides it from Ship now and stops every call.</p>
          </div>
          <Switch id="sm-enabled" checked={enabled} onCheckedChange={setEnabled} />
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
            href="https://docs.innofulfill.com"
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
          >
            InnoFulfill API docs
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
