"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, HandCoins, MessageCircle, PauseCircle, RadioTower } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import {
  advanceShareMessage,
  percentOf,
  requestState,
  validateAdvanceAmount,
  whatsappHref,
  type CodSettings,
} from "@/lib/shop/cod-advance";
import type { PaymentRequest } from "@/lib/types";
import {
  approveCod,
  markAdvanceReceived,
  requestAdvance,
  watchAdvance,
  withdrawAdvance,
} from "./advance-actions";

/**
 * The partial-COD panel on an order.
 *
 * One card that reads top-down as the story of the order's money: is it held,
 * has an advance been asked for, was it paid. Every state has exactly the
 * buttons that make sense from it and no others — an order Qikink already has
 * gets no "request advance", because the collectable amount can no longer
 * change on their side.
 *
 * Two things make it feel live rather than filed. The request dialog does not
 * close on "create": it turns into the send step, with the message and the
 * WhatsApp button, because creating a request nobody has been told about is
 * half a job. And while a request is open the card polls for the webhook, so
 * the moment the shopper pays, this page says so without a reload.
 */

/** The order fields the card needs, picked so the server page stays the source. */
export interface CodOrderView {
  order_number: number;
  total: number;
  amount_paid: number;
  currency: string;
  phone: string;
  first_name: string;
  payment_status: string;
  cancelled_at: string | null;
  held_at: string | null;
  released_at: string | null;
}

export function CodAdvanceCard({
  orderId,
  order,
  requests,
  qikinkSent,
  qikinkSentAt,
  settings,
  payLink,
}: {
  orderId: string;
  order: CodOrderView;
  requests: PaymentRequest[];
  /** Already in production at Qikink: the balance is fixed, no more asking. */
  qikinkSent: boolean;
  /** When it went, so an advance that arrived later can be flagged. */
  qikinkSentAt: string | null;
  settings: CodSettings;
  /** The shopper's own order page, absolute. Null when the order has no token. */
  payLink: string | null;
}) {
  const router = useRouter();
  const [approving, startApproving] = useTransition();
  const [withdrawing, startWithdrawing] = useTransition();
  const [receiving, startReceiving] = useTransition();

  const money = (n: number | string) => formatMoney(Number(n), order.currency);
  const onHold = Boolean(order.held_at) && !order.released_at;
  const cancelled = Boolean(order.cancelled_at);
  const paid = Number(order.amount_paid) > 0;
  const balance = Math.max(0, Number(order.total) - Number(order.amount_paid));

  const latest = requests[0] ?? null;
  const latestState = latest ? requestState(latest) : null;
  const active = latest && latestState === "open" ? latest : null;
  const lapsed = latest && latestState === "expired" ? latest : null;
  const paidRequest = requests.find((r) => r.status === "paid") ?? null;

  const canAsk =
    !cancelled && !qikinkSent && !paid && order.payment_status === "pending" && Boolean(payLink);

  // The one race this design cannot prevent: the shopper had the payment
  // window open while staff approved the order (or sent it by hand), so Qikink
  // received it as full COD and then the advance landed. The money is recorded
  // either way; what the operator needs is to be told, loudly, that the
  // courier will still ask for the whole total.
  const paidAfterSend =
    paid && qikinkSent && Boolean(qikinkSentAt) && Boolean(paidRequest?.paid_at) &&
    new Date(qikinkSentAt as string) < new Date(paidRequest?.paid_at as string);

  const watching = useAdvanceWatch(orderId, active, (snapshot) => {
    if (snapshot.amountPaid > 0 || snapshot.requestStatus === "paid") {
      toast.success(`${money(snapshot.amountPaid || active?.amount || 0)} advance received.`);
    } else {
      toast.info("This request was updated elsewhere.");
    }
    router.refresh();
  });

  function handleApprove() {
    startApproving(async () => {
      const result = await approveCod(orderId);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else toast.error(result.error);
    });
  }

  function handleWithdraw(requestId: string) {
    startWithdrawing(async () => {
      const result = await withdrawAdvance(orderId, requestId);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else toast.error(result.error);
    });
  }

  function handleReceived(requestId: string) {
    if (!window.confirm("Record this advance as received outside the gateway? The order will carry on as partial COD.")) return;
    startReceiving(async () => {
      const result = await markAdvanceReceived(orderId, requestId);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else toast.error(result.error);
    });
  }

  const shareMessage = (request: Pick<PaymentRequest, "amount" | "expires_at">) =>
    advanceShareMessage(settings.message, {
      name: order.first_name,
      orderNumber: order.order_number,
      amount: money(request.amount),
      balance: money(Number(order.total) - Number(request.amount)),
      link: payLink ?? "",
      expires: formatDate(request.expires_at),
    });

  return (
    <section className="order-card cod-card">
      <div className="section-heading">
        <h2 className="flex items-center gap-2">
          <span className={`section-icon ${onHold ? "unfulfilled" : ""}`}>
            {onHold ? <PauseCircle size={16} /> : <HandCoins size={16} />}
          </span>
          {paid ? "Partial cash on delivery" : onHold ? "Held for COD review" : "Cash on delivery"}
        </h2>
        <div className="flex items-center gap-2">
          {onHold && <Badge variant="secondary">Not sent to Qikink</Badge>}
          {canAsk && (
            <RequestDialog
              orderId={orderId}
              order={order}
              settings={settings}
              payLink={payLink ?? ""}
              replacing={Boolean(active)}
              onDone={() => router.refresh()}
            />
          )}
        </div>
      </div>

      {/* ---- The hold ---- */}
      {onHold && (
        <p className="order-muted text-sm">
          Parked by the COD rule {order.held_at ? `on ${formatDateTime(order.held_at)}` : ""} instead of going to Qikink.
          Approve it to ship as full cash on delivery, or ask the customer for an advance first.
        </p>
      )}

      {/* ---- Paid ---- */}
      {paid && (
        <div className="cod-state">
          <p className="flex items-center gap-2 text-sm">
            <Check size={16} className="text-emerald-600" />
            <span>
              <strong>{money(order.amount_paid)}</strong> advance received
              {paidRequest?.paid_at ? ` on ${formatDateTime(paidRequest.paid_at)}` : ""}.
            </span>
          </p>
          {paidAfterSend ? (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This order reached Qikink {qikinkSentAt ? formatDateTime(qikinkSentAt) : ""} as <strong>full</strong> cash on delivery, before the advance arrived — the courier will ask for {money(order.total)}. Refund the {money(order.amount_paid)} advance, or correct the amount with Qikink.
            </p>
          ) : (
            <p className="order-muted mt-1 text-sm">
              The courier collects <strong>{money(balance)}</strong> on delivery.
              {qikinkSent ? "" : " That balance is what Qikink will be told to collect."}
            </p>
          )}
        </div>
      )}

      {/* ---- Awaiting ---- */}
      {!paid && active && (
        <div className="cod-state">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              Waiting on a <strong>{money(active.amount)}</strong> advance
              <span className="order-muted"> · valid until {formatDateTime(active.expires_at)}</span>
            </p>
            <Badge variant="outline" className="gap-1.5">
              <RadioTower size={12} className={watching ? "animate-pulse text-emerald-600" : ""} />
              {watching ? "Watching for payment" : "Awaiting payment"}
            </Badge>
          </div>
          {active.reason && <p className="order-muted mt-1 text-sm">“{active.reason}”</p>}
          {payLink && (
            <SharePanel link={payLink} phone={order.phone} message={shareMessage(active)} />
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={receiving} onClick={() => handleReceived(active.id)}>
              Mark advance received
            </Button>
            <Button size="sm" variant="ghost" disabled={withdrawing} onClick={() => handleWithdraw(active.id)}>
              Withdraw request
            </Button>
          </div>
        </div>
      )}

      {/* ---- Lapsed ---- */}
      {!paid && !active && lapsed && (
        <div className="cod-state">
          <p className="text-sm">
            The <strong>{money(lapsed.amount)}</strong> advance request lapsed on {formatDateTime(lapsed.expires_at)} without payment.
          </p>
          <p className="order-muted mt-1 text-sm">
            Send a new request, or approve the order as full cash on delivery and let the courier collect everything.
          </p>
        </div>
      )}

      {/* ---- Nothing yet ---- */}
      {!paid && !active && !lapsed && !onHold && canAsk && (
        <p className="order-muted text-sm">
          Plain cash on delivery. Ask for an advance to confirm the customer means it — the courier collects the rest.
        </p>
      )}

      {/* ---- Approve ---- */}
      {!cancelled && onHold && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant={canAsk ? "outline" : "default"} disabled={approving} onClick={handleApprove}>
            {approving ? "Approving…" : "Approve as full COD"}
          </Button>
        </div>
      )}

      {qikinkSent && !paid && !onHold && (
        <p className="order-muted mt-2 text-xs">
          Already with Qikink as full cash on delivery, so the collectable amount can no longer change.
        </p>
      )}

      {/* ---- History ---- */}
      {requests.length > 1 && (
        <details className="mt-3 text-xs">
          <summary className="order-link cursor-pointer">Earlier requests</summary>
          <ul className="mt-2 space-y-1">
            {requests.slice(1).map((r) => (
              <li key={r.id} className="order-muted">
                {money(r.amount)} · {requestState(r)} · {formatDateTime(r.created_at)}
                {r.created_by_email ? ` · ${r.created_by_email}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Watching for the webhook                                                    */
/* -------------------------------------------------------------------------- */

/** How often to ask while a request is open. Cheap: two indexed reads. */
const WATCH_MS = 6_000;

/**
 * Polls `watchAdvance` while `active` is open and fires `onChange` once, the
 * first time the server says something happened — paid, withdrawn elsewhere,
 * lapsed. Pauses while the tab is hidden, because a page nobody is looking at
 * does not need to know yet, and resumes with an immediate check when they
 * come back. Returns whether it is currently watching, for the badge.
 */
function useAdvanceWatch(
  orderId: string,
  active: PaymentRequest | null,
  onChange: (snapshot: { requestStatus: PaymentRequest["status"]; amountPaid: number }) => void
): boolean {
  const requestId = active?.id ?? null;
  // The request id whose change has already been reported. Derived rather
  // than set from the effect: watching = "there is an open request and we
  // have not yet seen it change".
  const [reported, setReported] = useState<string | null>(null);
  const watching = Boolean(requestId) && reported !== requestId;

  // Latest-callback ref, updated after render so the interval never closes
  // over a stale callback and never restarts because the parent re-rendered.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!requestId || reported === requestId) return;

    let stopped = false;
    let inFlight = false;

    async function tick() {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const snapshot = await watchAdvance(orderId, requestId as string);
        if (stopped || !snapshot.ok) return;
        if (snapshot.requestStatus !== "open" || snapshot.amountPaid > 0) {
          stopped = true;
          setReported(requestId);
          onChangeRef.current(snapshot);
        }
      } catch {
        // A failed poll is not news. The next one will try again.
      } finally {
        inFlight = false;
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") void tick();
    }

    const id = setInterval(tick, WATCH_MS);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [orderId, requestId, reported]);

  return watching;
}

/* -------------------------------------------------------------------------- */
/* Share                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Getting the link to the customer. There is no outbound mail or SMS in this
 * store, so this is the whole delivery mechanism: copy, or open their WhatsApp
 * chat with the message already typed. Honest about that rather than dressing
 * a clipboard button up as a "send".
 */
function SharePanel({
  link,
  phone,
  message,
  editable = false,
}: {
  link: string;
  phone: string;
  message: string;
  /** In the dialog the message is a draft the operator can tweak before sending. */
  editable?: boolean;
}) {
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  const [draft, setDraft] = useState(message);
  const text = editable ? draft : message;
  const wa = whatsappHref(phone, text);

  async function copy(kind: "link" | "message") {
    try {
      await navigator.clipboard.writeText(kind === "link" ? link : text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("Could not copy — select it and copy by hand.");
    }
  }

  return (
    <div className="cod-share mt-3 space-y-2">
      {editable && (
        <Textarea
          aria-label="Message to the customer"
          rows={6}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="text-sm"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input readOnly value={link} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button size="sm" variant="outline" onClick={() => copy("link")}>
          {copied === "link" ? <Check size={14} /> : <Copy size={14} />}
          {copied === "link" ? "Copied" : "Copy link"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => copy("message")}>
          {copied === "message" ? <Check size={14} /> : <Copy size={14} />}
          {copied === "message" ? "Copied" : "Copy message"}
        </Button>
        {wa ? (
          <Button size="sm" asChild>
            <a href={wa} target="_blank" rel="noreferrer">
              <MessageCircle size={14} />
              Send on WhatsApp
            </a>
          </Button>
        ) : (
          <span className="order-muted text-xs">No phone number on this order for WhatsApp.</span>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Request dialog                                                              */
/* -------------------------------------------------------------------------- */

const VALIDITY_OPTIONS = [12, 24, 48, 72, 168];

/**
 * Two steps in one dialog. "Amount" creates the request; "Send" is what comes
 * up the moment it exists — the link, the message, WhatsApp — so the operator
 * finishes the job in the same place they started it.
 */
function RequestDialog({
  orderId,
  order,
  settings,
  payLink,
  replacing,
  onDone,
}: {
  orderId: string;
  order: CodOrderView;
  settings: CodSettings;
  payLink: string;
  /** An open request exists; this one replaces it. */
  replacing: boolean;
  onDone: () => void;
}) {
  const total = Number(order.total);
  const money = (n: number) => formatMoney(n, order.currency);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"amount" | "send">("amount");
  const [created, setCreated] = useState<Pick<PaymentRequest, "id" | "amount" | "expires_at"> | null>(null);
  const [amount, setAmount] = useState<string>(String(defaultAmount(settings, total)));
  const [hours, setHours] = useState<string>(String(settings.expiryHours));
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const parsed = Number(amount);
  const problem = amount === "" ? null : validateAdvanceAmount(parsed, total);

  // Quick picks: the store's fixed presets, plus the percentage, each filtered
  // to what this order can actually take (a ₹299 chip on a ₹250 order is an
  // invitation to an error message).
  const picks = useMemo(() => {
    const fixed = settings.presets.filter((p) => p < total).map((p) => ({ label: money(p), value: p }));
    const pct = percentOf(total, settings.percent);
    if (pct < total && !settings.presets.includes(pct)) {
      fixed.push({ label: `${settings.percent}% · ${money(pct)}`, value: pct });
    }
    return fixed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, total, order.currency]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset so the next open starts at the amount again. The page itself
      // was refreshed the moment the request was created, so there is nothing
      // left to sync on close.
      setStep("amount");
      setCreated(null);
      setReason("");
    }
  }

  function submit() {
    if (problem || amount === "") {
      toast.error(problem ?? "Enter an amount.");
      return;
    }
    startTransition(async () => {
      const result = await requestAdvance(orderId, {
        amount: parsed,
        expiresInHours: Number(hours),
        reason,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCreated(result.request);
      setStep("send");
      // Refresh the page *under* the open dialog: the card behind it picks up
      // the new request and starts watching for the payment straight away,
      // while the operator is still copying the link. This dialog keeps its
      // own state through the refresh because it stays mounted.
      onDone();
    });
  }

  const message = created
    ? advanceShareMessage(settings.message, {
        name: order.first_name,
        orderNumber: order.order_number,
        amount: money(Number(created.amount)),
        balance: money(total - Number(created.amount)),
        link: payLink,
        expires: formatDate(created.expires_at),
      })
    : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">{replacing ? "New request" : "Request partial COD"}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {step === "amount" ? "Request partial COD" : "Send it to the customer"}
          </DialogTitle>
        </DialogHeader>

        {step === "amount" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The customer pays this online now; the courier collects the rest at the door.
              Order total {money(total)}.
              {replacing && " This replaces the request that is currently open."}
            </p>

            {picks.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {picks.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    size="sm"
                    variant={parsed === p.value ? "default" : "outline"}
                    onClick={() => setAmount(String(p.value))}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="adv-amount">Advance amount</Label>
              <Input
                id="adv-amount"
                type="number"
                inputMode="decimal"
                min="1"
                max={Math.max(1, total - 1)}
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {problem
                  ? problem
                  : amount !== ""
                    ? `Remaining ${money(Math.max(0, total - parsed))} on delivery.`
                    : "Less than the order total."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adv-hours">Valid for</Label>
              <Select value={hours} onValueChange={setHours}>
                <SelectTrigger id="adv-hours">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...VALIDITY_OPTIONS, settings.expiryHours])]
                    .sort((a, b) => a - b)
                    .map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h < 24 ? `${h} hours` : h === 24 ? "1 day" : `${Math.round(h / 24)} days`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adv-reason">Note to the customer (optional)</Label>
              <Textarea
                id="adv-reason"
                rows={2}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Shown on their order page under the pay button."
              />
            </div>

            <Button className="w-full" disabled={pending || Boolean(problem) || amount === ""} onClick={submit}>
              {pending ? "Creating…" : "Create request"}
            </Button>
          </div>
        ) : (
          created && (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm">
                <Check size={16} className="text-emerald-600" />
                <span>
                  <strong>{money(Number(created.amount))}</strong> requested · valid until {formatDateTime(created.expires_at)}.
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Nothing has been sent yet. Copy the link or the message, or open WhatsApp with it ready to go.
                This page will update on its own when the payment lands.
              </p>
              <SharePanel link={payLink} phone={order.phone} message={message} editable />
              <Button className="w-full" variant="outline" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The first preset that fits, else the percentage — never a blank box. */
function defaultAmount(settings: CodSettings, total: number): number {
  const fit = settings.presets.find((p) => p < total);
  if (fit) return fit;
  const pct = percentOf(total, settings.percent);
  return pct < total ? pct : Math.max(1, Math.floor(total / 2));
}
