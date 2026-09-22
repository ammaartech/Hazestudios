"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, MapPin, Printer, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { packageProblems, volumetricWeightKg, type PackageInput, type ShipmentDraft, type ShipmentParty } from "@/lib/couriers/draft";
import { COURIER_PROVIDERS, COURIERS, type CourierProvider } from "@/lib/couriers/providers";
import type { CourierAvailability } from "@/lib/couriers/config";
import type { CourierShipment } from "@/lib/couriers/shipments";
import { checkCourierServiceability, shipOrder, type ServiceabilityResult } from "../ship-actions";

/**
 * "Ship now": book a courier for an order the store packs itself.
 *
 * The dialog is a confirmation, not a form. Everything a courier needs was
 * already typed once — by the shopper at checkout, by the operator in Settings
 * → Shipping — so the operator's whole job here is three decisions: which
 * courier, which service, and whether the parcel is the usual size. The
 * address and the money are shown, not edited; if either is wrong the fix is
 * on the order, and the dialog says exactly what to fix.
 *
 * On success the dialog does not simply close. It turns into the "it's booked"
 * step with the waybill number, the label and the tracking link, because a
 * booking nobody can print is half a job.
 */
export function ShipNowDialog({
  orderId,
  draft,
  availability,
  disabled = false,
}: {
  orderId: string;
  draft: ShipmentDraft;
  availability: Record<CourierProvider, CourierAvailability>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const ready = COURIER_PROVIDERS.filter((p) => availability[p]?.ready);
  const anyReady = ready.length > 0;

  const [provider, setProvider] = useState<CourierProvider>(ready[0] ?? "shreemaruti");
  const [service, setService] = useState<string>(() => defaultService(ready[0] ?? "shreemaruti", availability));
  const [pkg, setPkg] = useState(() => toFields(draft.pkg));
  const [note, setNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [booked, setBooked] = useState<{ shipment: CourierShipment; warnings: string[] } | null>(null);

  const parsed = useMemo<PackageInput>(
    () => ({
      weightKg: Number.parseFloat(pkg.weightKg),
      lengthCm: Number.parseFloat(pkg.lengthCm),
      widthCm: Number.parseFloat(pkg.widthCm),
      heightCm: Number.parseFloat(pkg.heightCm),
      pieces: Number.parseInt(pkg.pieces, 10),
    }),
    [pkg]
  );
  const pkgProblems = useMemo(() => packageProblems(parsed), [parsed]);
  const volumetric = Number.isFinite(parsed.lengthCm * parsed.widthCm * parsed.heightCm) ? volumetricWeightKg(parsed) : 0;

  const blockers = [...draft.problems, ...pkgProblems, ...problems];
  const canShip = anyReady && availability[provider]?.ready && blockers.length === 0 && !pending;
  const meta = COURIERS[provider];
  const money = (n: number) => formatMoney(n, draft.currency);

  function choose(next: CourierProvider) {
    setProvider(next);
    setService(defaultService(next, availability));
    setProblems([]);
  }

  function reset() {
    setPkg(toFields(draft.pkg));
    setNote("");
    setProblems([]);
    setBooked(null);
  }

  function handleShip() {
    startTransition(async () => {
      const result = await shipOrder(orderId, { provider, service, pkg: parsed, note });
      if (!result.ok) {
        setProblems(result.problems ?? []);
        toast.error(result.error);
        return;
      }
      setBooked({ shipment: result.shipment, warnings: result.warnings });
      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="ship-now" size="sm" disabled={disabled}>
          <Truck className="size-3.5" aria-hidden />
          Ship now
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {booked ? (
          <BookedStep
            shipment={booked.shipment}
            warnings={booked.warnings}
            orderNumber={draft.orderNumber}
            onDone={() => setOpen(false)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Ship order #{draft.orderNumber}</DialogTitle>
              <DialogDescription>
                Book a courier with the order&rsquo;s details filled in. Pick the courier and confirm the parcel.
              </DialogDescription>
            </DialogHeader>

            {!anyReady && (
              <Notice tone="warning">
                No courier is connected yet.{" "}
                <Link href="/admin/settings/shipping" className="font-medium underline">
                  Add Shree Maruti or Blue Dart credentials in Settings → Shipping
                </Link>{" "}
                to book from here.
              </Notice>
            )}

            {/* Courier */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Courier</legend>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Courier">
                {COURIER_PROVIDERS.map((p) => {
                  const a = availability[p];
                  const selected = provider === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={!a?.ready}
                      onClick={() => choose(p)}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                        selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50",
                        !a?.ready && "cursor-not-allowed opacity-60"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                          selected ? "border-primary bg-primary text-primary-foreground" : "border-input"
                        )}
                        aria-hidden
                      >
                        {selected && <span className="size-2 rounded-full bg-primary-foreground" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {COURIERS[p].name}
                          {a?.ready && a.environment === "sandbox" && <Badge variant="secondary">Sandbox</Badge>}
                          {!a?.ready && <Badge variant="outline">Not connected</Badge>}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {a?.ready
                            ? COURIERS[p].services.map((s) => s.label).join(" · ")
                            : "Add credentials in Settings → Shipping"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Service */}
            {availability[provider]?.ready && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Service</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Service">
                  {meta.services.map((s) => (
                    <button
                      key={s.code}
                      type="button"
                      role="radio"
                      aria-checked={service === s.code}
                      onClick={() => setService(s.code)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm transition-colors",
                        service === s.code ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {meta.services.find((s) => s.code === service)?.hint}
                </p>
              </fieldset>
            )}

            {/* Parcel */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Parcel</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Field id="ship-weight" label="Weight (kg)" value={pkg.weightKg} step="0.05" onChange={(v) => setPkg({ ...pkg, weightKg: v })} />
                <Field id="ship-length" label="Length (cm)" value={pkg.lengthCm} onChange={(v) => setPkg({ ...pkg, lengthCm: v })} />
                <Field id="ship-width" label="Width (cm)" value={pkg.widthCm} onChange={(v) => setPkg({ ...pkg, widthCm: v })} />
                <Field id="ship-height" label="Height (cm)" value={pkg.heightCm} onChange={(v) => setPkg({ ...pkg, heightCm: v })} />
                <Field id="ship-pieces" label="Pieces" value={pkg.pieces} step="1" onChange={(v) => setPkg({ ...pkg, pieces: v })} />
              </div>
              <p className="text-xs text-muted-foreground">
                {draft.itemCount} {draft.itemCount === 1 ? "item" : "items"} · volumetric {volumetric.toFixed(2)} kg
                {volumetric > parsed.weightKg && " — the courier bills on the higher of the two"}. Defaults come from{" "}
                <Link href="/admin/settings/shipping" className="underline">Settings → Shipping</Link>.
              </p>
            </fieldset>

            {/* Summary */}
            <div className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2">
              <Party title="Ship to" party={draft.consignee} />
              <Party title="Ship from" party={draft.pickup} empty="No pickup address yet" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment</p>
                <p className="mt-1 font-medium">
                  {draft.paymentMode === "cod" ? `Cash on delivery — collect ${money(draft.collectableAmount)}` : "Prepaid — nothing to collect"}
                </p>
                <p className="text-xs text-muted-foreground">Declared value {money(draft.declaredValue)}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contents</p>
                <ul className="mt-1 space-y-0.5">
                  {draft.items.slice(0, 4).map((item, i) => (
                    <li key={i} className="truncate">
                      {item.quantity} × {item.name}
                    </li>
                  ))}
                  {draft.items.length > 4 && <li className="text-muted-foreground">+{draft.items.length - 4} more</li>}
                </ul>
              </div>
            </div>

            {availability[provider]?.ready && draft.problems.length === 0 && (
              <Serviceability key={provider} orderId={orderId} provider={provider} />
            )}

            <div className="space-y-2">
              <Label htmlFor="ship-note">Note for the courier (optional)</Label>
              <Input
                id="ship-note"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Fragile, call before delivery…"
              />
            </div>

            {blockers.length > 0 && (
              <Notice tone="error" title="Fix before shipping">
                <ul className="list-disc space-y-1 pl-5">
                  {blockers.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {draft.warnings.length > 0 && (
              <Notice tone="warning">
                <ul className="list-disc space-y-1 pl-5">
                  {draft.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Notice>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" onClick={handleShip} disabled={!canShip}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Booking…
                  </>
                ) : (
                  `Ship with ${meta.name}`
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function defaultService(provider: CourierProvider, availability: Record<CourierProvider, CourierAvailability>): string {
  const meta = COURIERS[provider];
  const preferred = availability[provider]?.defaultService;
  return meta.services.some((s) => s.code === preferred) ? preferred : meta.services[0].code;
}

function toFields(pkg: PackageInput) {
  return {
    weightKg: String(pkg.weightKg),
    lengthCm: String(pkg.lengthCm),
    widthCm: String(pkg.widthCm),
    heightCm: String(pkg.heightCm),
    pieces: String(pkg.pieces),
  };
}

function Field({
  id,
  label,
  value,
  step = "1",
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  step?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input id={id} type="number" inputMode="decimal" min="0" step={step} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Party({ title, party, empty }: { title: string; party: ShipmentParty | null; empty?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {party ? (
        <address className="mt-1 not-italic leading-5">
          <span className="font-medium">{party.name || "—"}</span>
          <br />
          {party.address1}
          {party.address2 && <>, {party.address2}</>}
          <br />
          {[party.city, party.state, party.postal_code].filter(Boolean).join(" ")}
          <br />
          <span className="text-muted-foreground">{party.phone || "No phone"}</span>
        </address>
      ) : (
        <p className="mt-1 text-muted-foreground">
          {empty ?? "—"} ·{" "}
          <Link href="/admin/settings/shipping" className="underline">
            Set it up
          </Link>
        </p>
      )}
    </div>
  );
}

function Notice({ tone, title, children }: { tone: "error" | "warning"; title?: string; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-2 rounded-lg border p-3 text-sm",
        tone === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-amber-200 bg-amber-50 text-amber-900"
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        <div className={tone === "error" ? "text-destructive/90" : ""}>{children}</div>
      </div>
    </div>
  );
}

/**
 * Asks the selected courier whether they deliver to the address, once per
 * selection — the component is keyed by provider and mounted only while the
 * dialog is open, so mounting *is* the trigger. A "no" does not block the
 * button: their answer is advisory and the booking itself is the authority,
 * but nobody should find out after pressing Ship. A courier with no check
 * (Blue Dart) renders nothing.
 */
function Serviceability({ orderId, provider }: { orderId: string; provider: CourierProvider }) {
  const [state, setState] = useState<{ loading: boolean; result: ServiceabilityResult | null }>({ loading: true, result: null });
  const name = COURIERS[provider].name;

  useEffect(() => {
    let cancelled = false;
    checkCourierServiceability(orderId, provider).then((result) => {
      if (!cancelled) setState({ loading: false, result });
    });
    return () => {
      cancelled = true;
    };
  }, [orderId, provider]);

  if (state.loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Checking whether {name} delivers to this pincode…
      </p>
    );
  }
  const r = state.result;
  if (!r) return null;
  if (!r.ok) return r.unsupported ? null : <p className="text-xs text-muted-foreground">Could not check serviceability: {r.error}</p>;
  return (
    <p className={cn("flex items-center gap-2 text-xs", r.serviceable ? "text-emerald-700" : "text-amber-700")}>
      <MapPin className="size-3.5" aria-hidden />
      {r.serviceable
        ? `${name} delivers here${r.destination ? ` — ${r.destination}` : ""}${r.codServiceable === false ? " (prepaid only — no COD)" : ""}.`
        : `${name} says this route is not serviceable${r.reason ? `: ${r.reason}` : ""}.`}
    </p>
  );
}

function BookedStep({
  shipment,
  warnings,
  orderNumber,
  onDone,
}: {
  shipment: CourierShipment;
  warnings: string[];
  orderNumber: number;
  onDone: () => void;
}) {
  const meta = COURIERS[shipment.provider];
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!shipment.awb) return;
    try {
      await navigator.clipboard.writeText(shipment.awb);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Check className="size-4" aria-hidden />
          </span>
          Booked with {meta.name}
        </DialogTitle>
        <DialogDescription>
          Order #{orderNumber} is now fulfilled. The customer&rsquo;s order page shows the tracking number.
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-lg border p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{meta.awbLabel}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-semibold tabular-nums">{shipment.awb}</span>
          <Button type="button" variant="ghost" size="sm" onClick={copy} aria-label="Copy waybill number">
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          </Button>
        </div>
        {(shipment.destination_area || shipment.destination_location) && (
          <p className="mt-1 text-xs text-muted-foreground">
            Routed via {[shipment.destination_location, shipment.destination_area].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {warnings.length > 0 && (
        <Notice tone="warning">
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button asChild variant="outline">
          <a href={`/api/admin/shipments/${shipment.id}/label`} target="_blank" rel="noreferrer noopener">
            <Printer className="size-4" aria-hidden />
            Print label
          </a>
        </Button>
        {shipment.tracking_url && (
          <Button asChild variant="outline">
            <a href={shipment.tracking_url} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="size-4" aria-hidden />
              Track
            </a>
          </Button>
        )}
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </>
  );
}
