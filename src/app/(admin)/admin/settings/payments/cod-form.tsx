"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_ADVANCE_MESSAGE,
  EXPIRY_HOURS_MAX,
  EXPIRY_HOURS_MIN,
  type CodSettings,
} from "@/lib/shop/cod-advance";
import { saveCodSettings } from "./actions";

/**
 * The partial-COD controls: when to park a COD order for a look, and what the
 * "Request advance" dialog offers by default. Sits under the gateway card
 * because the advance is collected through it — with Cashfree off, a request
 * can be created but nobody can pay it.
 */
export function CodForm({ settings, gatewayLive }: { settings: CodSettings; gatewayLive: boolean }) {
  const [pending, startTransition] = useTransition();

  const [holdEnabled, setHoldEnabled] = useState(settings.holdEnabled);
  const [holdMinTotal, setHoldMinTotal] = useState(
    settings.holdMinTotal == null ? "" : String(settings.holdMinTotal)
  );
  const [presets, setPresets] = useState(settings.presets.join(", "));
  const [percent, setPercent] = useState(String(settings.percent));
  const [expiryHours, setExpiryHours] = useState(String(settings.expiryHours));
  const [message, setMessage] = useState(settings.message);

  function handleSave() {
    startTransition(async () => {
      const result = await saveCodSettings({
        hold_enabled: holdEnabled,
        hold_min_total: holdMinTotal.trim() === "" ? null : Number(holdMinTotal),
        presets: presets
          .split(/[,\s]+/)
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v) && v > 0),
        percent: Number(percent),
        expiry_hours: Number(expiryHours),
        message,
      });
      if (result.ok) toast.success(result.message ?? "Saved");
      else toast.error(result.error);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Cash on delivery</CardTitle>
        <Badge variant={holdEnabled ? "default" : "secondary"}>
          {holdEnabled ? "Review on" : "Review off"}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          COD orders that come back unpaid are the expensive ones. Hold the risky
          ones for a look before they go to Qikink, and ask the customer for a
          small advance online — the courier collects the rest at the door.
          {!gatewayLive && (
            <span className="block pt-1 font-medium text-foreground">
              Advances are collected through Cashfree, which is currently off.
            </span>
          )}
        </p>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="cod-hold">Hold COD orders for review</Label>
              <p className="text-xs text-muted-foreground">
                Held orders wait on the <span className="font-medium">Needs review</span> list
                instead of being sent to Qikink automatically.
              </p>
            </div>
            <Switch id="cod-hold" checked={holdEnabled} onCheckedChange={setHoldEnabled} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cod-min">Only when the order total is at least</Label>
            <Input
              id="cod-min"
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              placeholder="Every COD order"
              value={holdMinTotal}
              onChange={(e) => setHoldMinTotal(e.target.value)}
              disabled={!holdEnabled}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              In rupees. Leave blank to hold every cash-on-delivery order.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="cod-presets">Quick amounts</Label>
            <Input
              id="cod-presets"
              value={presets}
              onChange={(e) => setPresets(e.target.value)}
              placeholder="99, 199, 299"
            />
            <p className="text-xs text-muted-foreground">Comma-separated, in rupees.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cod-percent">Percentage pick</Label>
            <Input
              id="cod-percent"
              type="number"
              min="1"
              max="99"
              step="1"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Of the order total.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cod-expiry">Valid for (hours)</Label>
            <Input
              id="cod-expiry"
              type="number"
              min={EXPIRY_HOURS_MIN}
              max={EXPIRY_HOURS_MAX}
              step="1"
              value={expiryHours}
              onChange={(e) => setExpiryHours(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Default deadline on a new request.</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="cod-message">Message to the customer</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMessage(DEFAULT_ADVANCE_MESSAGE)}
              disabled={message === DEFAULT_ADVANCE_MESSAGE}
            >
              Reset
            </Button>
          </div>
          <Textarea
            id="cod-message"
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            What the WhatsApp and copy buttons on an order send. Placeholders:{" "}
            <code>{"{name}"}</code> <code>{"{order}"}</code> <code>{"{amount}"}</code>{" "}
            <code>{"{balance}"}</code> <code>{"{link}"}</code> <code>{"{expires}"}</code>.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
