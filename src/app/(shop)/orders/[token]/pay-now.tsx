"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock } from "lucide-react";
import { confirmPayment, retryPayment } from "@/app/(checkout)/checkout/actions";

/**
 * Taking payment for an order that has been placed but not paid for.
 *
 * This is where the payment window lives, for every route into it — the shopper
 * who just pressed "Place order", and the one coming back to a link days later.
 * Checkout deliberately does not open it: `place_order()` deletes the cart, so
 * a Server Action returning to /checkout re-renders a page whose own guard
 * bounces an empty bag to /cart, killing the modal on the way out. The order
 * page has no such guard and is reachable by its token forever.
 *
 * Three jobs, in one component because they are three answers to one question —
 * has this been paid, and if not, can it be now.
 *
 * **Arriving from checkout, it opens the window immediately.** `autoStart` says
 * there are no attempts on this order yet, which is only true on the first
 * render after it was placed. That fact is the trigger rather than a query
 * parameter: it cannot be replayed by a reload, because the attempt it creates
 * is what makes it false.
 *
 * **Arriving any other way, it reconciles.** The shopper can be back here before
 * Cashfree's webhook has left their servers, and a page saying "unpaid" about
 * money already gone is the worst thing this flow can do. It is also the safety
 * net for a webhook that never arrives — a dead tunnel, a deploy mid-delivery.
 *
 * **Either way it offers another go.** A dismissed modal, a declined card, a
 * gateway that was down. Each press mints a fresh Cashfree session against the
 * same order of ours.
 */
export function PayNow({
  token,
  autoStart,
}: {
  token: string;
  /** No payment has been attempted yet, i.e. the shopper just got here. */
  autoStart: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [checking, startChecking] = useTransition();

  /* Once per mount, whichever branch runs. `confirmPayment` redirects to this
     same URL, which remounts this component — without the guard that is a
     loop, and in the autoStart branch an expensive one that mints a Cashfree
     order every time round. */
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (autoStart) {
      // Straight from checkout. Opening without a second click is the whole
      // point — the shopper already pressed a button that said "Place order",
      // and asking them to press another one to pay for it is a step that only
      // exists because of how this is built.
      void pay();
      return;
    }

    startChecking(async () => {
      try {
        await confirmPayment(token);
      } catch {
        // `redirect()` throws to unwind, and a genuine failure leaves the page
        // exactly as it is — which is correct. Unpaid is the truth until the
        // gateway says otherwise.
      }
    });
    // `pay` is stable for the life of this component and re-running this effect
    // is precisely what `ran` exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, autoStart]);

  async function pay() {
    setError(null);
    setPaying(true);

    const started = await retryPayment(token);
    if (!started.ok) {
      setError(started.error);
      setPaying(false);
      // The most likely reason a retry is refused is that the order is already
      // paid — a webhook landing while this page sat open. Refreshing turns
      // that refusal into the paid state it actually represents.
      router.refresh();
      return;
    }

    const { openCashfreeCheckout } = await import(
      "@/app/(checkout)/checkout/cashfree-modal"
    );
    const outcome = await openCashfreeCheckout({
      paymentSessionId: started.payment.sessionId,
      mode: started.payment.mode,
    });

    if (outcome === "unavailable") {
      setError("The payment window could not open. Please try again.");
      setPaying(false);
      return;
    }

    // Redirects to this page on its way out, so the paid copy renders in place
    // of this block. `paying` is left set through the navigation on purpose.
    await confirmPayment(token);
  }

  return (
    <section className="mt-12 rounded-3xl bg-(--shop-cloud) px-5 py-6 md:px-7 md:py-7">
      <h2 className="meta text-(--shop-mute)">Payment</h2>
      <p className="mt-3 max-w-prose text-sm text-(--shop-charcoal)">
        {checking
          ? "Checking with your bank…"
          : paying
            ? "Finish in the payment window. Don't close this page."
            : "Your order is held and nothing has been charged. Complete the payment to send it into production."}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-2xl bg-(--shop-sale)/8 px-4 py-3 text-sm text-(--shop-sale)"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={pay}
        disabled={paying || checking}
        className="glass glass-pill glass-press glass-primary mt-5 flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 px-8 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--shop-ink) disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {paying ? (
          "Waiting for payment…"
        ) : (
          <>
            {/* "Pay now" on a return visit; "Try again" once an attempt has
                already failed in this session and left a message above it. */}
            {error ? "Try again" : "Pay now"}
            <ArrowRight className="size-4" aria-hidden />
          </>
        )}
      </button>

      <p className="mt-4 flex items-center gap-2 text-xs text-(--shop-mute)">
        <Lock className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        Handled by Cashfree. We never see your card details.
      </p>
    </section>
  );
}
