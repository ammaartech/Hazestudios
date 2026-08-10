"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, ExternalLink } from "lucide-react";
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
import type { CashfreeStatus } from "@/lib/cashfree/config";
import { saveCashfreeSettings, testCashfreeConnection } from "./actions";

export function CashfreeForm({
  status,
  /* Resolved on the server from the request, so it is right in the first paint
     and right behind a proxy — `window.location.origin` would be neither. */
  webhookUrl,
}: {
  status: CashfreeStatus;
  webhookUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [testing, startTesting] = useTransition();

  const [environment, setEnvironment] = useState(status.environment);
  const [appId, setAppId] = useState(status.appId);
  // Starts blank whether or not a secret is stored: the stored one is never
  // sent to the browser, so there is nothing to prefill it with. Left blank on
  // save, it means "keep what's there".
  const [secretKey, setSecretKey] = useState("");
  const [enabled, setEnabled] = useState(status.enabled);

  const [copied, setCopied] = useState(false);

  function handleSave() {
    startTransition(async () => {
      const result = await saveCashfreeSettings({
        environment,
        appId,
        secretKey,
        enabled,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSecretKey("");
      toast.success(result.message ?? "Saved");
      router.refresh();
    });
  }

  function handleTest() {
    startTesting(async () => {
      const result = await testCashfreeConnection();
      if (result.ok) toast.success(result.message ?? "Connected");
      else toast.error(result.error);
    });
  }

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the URL and copy it by hand.");
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Cashfree Payments</CardTitle>
          <Badge variant={status.configured && status.enabled ? "default" : "secondary"}>
            {status.configured && status.enabled
              ? "Live"
              : status.configured
                ? "Configured, off"
                : "Not connected"}
          </Badge>
        </CardHeader>

        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            The gateway behind{" "}
            <span className="font-medium text-foreground">Pay online</span> at
            checkout — UPI, cards, net banking and wallets. While this is off,
            that option is shown greyed out and only cash on delivery can be
            chosen.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cf-env">Environment</Label>
              <Select
                value={environment}
                onValueChange={(v) =>
                  setEnvironment(v as CashfreeStatus["environment"])
                }
              >
                <SelectTrigger id="cf-env">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Sandbox — test cards</SelectItem>
                  <SelectItem value="live">Live — real money</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {environment === "sandbox"
                  ? "sandbox.cashfree.com. Nothing here is ever charged."
                  : "api.cashfree.com. Every payment here is real and settles to your bank."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-app-id">App ID</Label>
              <Input
                id="cf-app-id"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="TEST1234567890abcdef"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Dashboard → Developers → API Keys.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-secret">Secret Key</Label>
            <Input
              id="cf-secret"
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={
                status.hasSecret
                  ? "•••••••••••••••• — leave blank to keep"
                  : "Paste the secret key"
              }
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              Different for sandbox and live, so switching environment means
              entering the other one. Stored server-side and never sent back to
              this page. It also signs the webhooks below — there is no second
              secret to configure.
            </p>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-0.5">
                <Label htmlFor="cf-enabled">Accept online payments</Label>
                <p className="text-xs text-muted-foreground">
                  Off removes the option from checkout. Orders already awaiting
                  payment keep their link, but it will not open.
                </p>
              </div>
              <Switch
                id="cf-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
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

      {/* Second card, not a field in the first, because it is not a setting —
          it is a value to carry to Cashfree. Without it nothing ever marks an
          order paid, which is the failure most likely to go unnoticed: checkout
          works, the money arrives, and every order still reads unpaid. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Register this URL at{" "}
            <span className="font-medium text-foreground">
              Cashfree Dashboard → Developers → Webhooks
            </span>
            , once per environment. It is how a completed payment marks the order
            paid and releases it to Qikink.
          </p>

          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2 text-xs whitespace-nowrap text-foreground">
              {webhookUrl || "…"}
            </code>
            <Button
              variant="outline"
              size="icon"
              onClick={copyWebhook}
              disabled={!webhookUrl}
              aria-label="Copy webhook URL"
            >
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
            </Button>
          </div>

          <p>
            Subscribe it to{" "}
            <span className="font-medium text-foreground">Payment Success</span>,{" "}
            <span className="font-medium text-foreground">Payment Failed</span>{" "}
            and{" "}
            <span className="font-medium text-foreground">User Dropped</span>.
            Every delivery is checked against the Secret Key above and rejected
            if it does not match.
          </p>

          <p>
            On localhost this address is unreachable from Cashfree — run a tunnel
            (<code className="text-xs">ngrok http 3000</code>) and register the
            tunnel&rsquo;s URL instead. Without a webhook, payments still settle:
            the order page asks Cashfree directly when the shopper returns. The
            webhook is what covers the shopper who closes the tab first.
          </p>

          <a
            href="https://merchant.cashfree.com"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
          >
            Open Cashfree dashboard
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How a prepaid order flows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              The shopper picks{" "}
              <span className="font-medium text-foreground">Pay online</span> and
              gets 5% off the merchandise total instead of the ₹49 COD fee.
            </li>
            <li>
              Placing the order writes it here first, as{" "}
              <span className="font-medium text-foreground">pending</span> —
              stock is reserved before any money is asked for.
            </li>
            <li>
              A Cashfree window opens over the checkout page for the exact order
              total, read back from the database.
            </li>
            <li>
              On success the order becomes{" "}
              <span className="font-medium text-foreground">paid</span> and is
              pushed to Qikink as{" "}
              <span className="font-medium text-foreground">Prepaid</span> — if
              Qikink auto-send is on.
            </li>
            <li>
              A shopper who closes the window keeps their order and a{" "}
              <span className="font-medium text-foreground">Pay now</span> button
              on its status page. Nothing is cancelled automatically, so an order
              stuck pending is yours to void.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
