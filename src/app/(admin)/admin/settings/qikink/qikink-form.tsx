"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { QikinkStatus } from "@/lib/qikink/config";
import { saveQikinkSettings, testQikinkConnection } from "./actions";
import { QikinkTestOrder } from "./qikink-test-order";

export function QikinkForm({ status }: { status: QikinkStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [testing, startTesting] = useTransition();

  const [environment, setEnvironment] = useState(status.environment);
  const [clientId, setClientId] = useState(status.clientId);
  // Starts blank whether or not a secret is stored: the stored one is never
  // sent to the browser, so there is nothing to prefill it with. Left blank on
  // save, it means "keep what's there".
  const [clientSecret, setClientSecret] = useState("");
  const [enabled, setEnabled] = useState(status.enabled);
  const [autoSend, setAutoSend] = useState(status.autoSend);

  function handleSave() {
    startTransition(async () => {
      const result = await saveQikinkSettings({
        environment,
        clientId,
        clientSecret,
        enabled,
        autoSend,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setClientSecret("");
      toast.success(result.message ?? "Saved");
      router.refresh();
    });
  }

  function handleTest() {
    startTesting(async () => {
      const result = await testQikinkConnection();
      if (result.ok) toast.success(result.message ?? "Connected");
      else toast.error(result.error);
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Qikink</CardTitle>
          <Badge variant={status.configured && status.enabled ? "default" : "secondary"}>
            {status.configured && status.enabled
              ? "Connected"
              : status.configured
                ? "Configured, off"
                : "Not connected"}
          </Badge>
        </CardHeader>

        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Print on demand fulfillment. Orders are sent to Qikink and matched by
            SKU — each variant here must carry the{" "}
            <span className="font-medium text-foreground">Store SKU</span> from
            My Products → Product Variations (the long{" "}
            <code className="text-xs">v-…=</code> code), not the Product SKU.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="qikink-env">Environment</Label>
              <Select
                value={environment}
                onValueChange={(v) => setEnvironment(v as QikinkStatus["environment"])}
              >
                <SelectTrigger id="qikink-env">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Sandbox — testing</SelectItem>
                  <SelectItem value="live">Live — real orders</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {environment === "sandbox"
                  ? "sandbox.qikink.com. Nothing here reaches production."
                  : "api.qikink.com. Orders sent here are really printed and shipped."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="qikink-client-id">Client ID</Label>
              <Input
                id="qikink-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="42393901159948"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                The same for both environments.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qikink-secret">Client Secret</Label>
            <Input
              id="qikink-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={
                status.hasSecret ? "•••••••••••••••• — leave blank to keep" : "Paste the secret"
              }
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              Differs between sandbox and live. Stored server-side and never sent
              back to this page — switching environment means entering the other one.
            </p>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-0.5">
                <Label htmlFor="qikink-enabled">Enable Qikink</Label>
                <p className="text-xs text-muted-foreground">
                  Off hides the integration everywhere and stops all sending.
                </p>
              </div>
              <Switch id="qikink-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="flex items-start justify-between gap-6 border-t pt-3">
              <div className="space-y-0.5">
                <Label htmlFor="qikink-auto">Auto-send new orders</Label>
                <p className="text-xs text-muted-foreground">
                  Push each order to Qikink as it is placed. Leave off until a
                  manual send has proved your SKUs match — a wrong SKU goes into
                  production before you can catch it.
                </p>
              </div>
              <Switch
                id="qikink-auto"
                checked={autoSend}
                onCheckedChange={setAutoSend}
                disabled={!enabled}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || !status.configured}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
            {!status.configured && (
              <span className="text-xs text-muted-foreground">
                Save credentials first
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Only once a token can actually be minted — a test sender that is
          guaranteed to fail is noise. Reads the saved environment, not the
          unsaved picker above, since that is what a send would really use. */}
      {status.configured && status.enabled && (
        <QikinkTestOrder environment={status.environment} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How the two are linked</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Qikink can push products straight into Shopify and WooCommerce, but
            not into a custom store — its API has no product endpoints. So
            products are not synced; they are <em>matched</em>.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Build the product in Qikink (garment + design + print type).</li>
            <li>
              Open <span className="font-medium text-foreground">Product Variations</span>{" "}
              and copy the <span className="font-medium text-foreground">Store SKU</span>{" "}
              for every size and colour.
            </li>
            <li>
              Create the matching product here and paste each one into that
              variant&rsquo;s SKU field.
            </li>
            <li>
              When an order is sent, Qikink resolves the garment and artwork from
              that SKU and prints it.
            </li>
          </ol>
          <p>
            The other two columns are not the join.{" "}
            <span className="font-medium text-foreground">Product SKU</span>{" "}
            (<code className="text-xs">MRnHs-Bk-S</code>) is only the blank
            garment — it is shared by every product built on it, so it cannot say
            which design to print.{" "}
            <span className="font-medium text-foreground">Design SKU</span> names
            the artwork alone.
          </p>
          <p>
            A line item whose SKU is blank or unknown to Qikink will stop the
            order being sent — the order page says which one.
          </p>
          <a
            href="https://dashboard.qikink.com"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
          >
            Open Qikink dashboard
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
