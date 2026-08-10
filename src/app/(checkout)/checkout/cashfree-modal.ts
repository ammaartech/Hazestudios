/**
 * Opening Cashfree's checkout, and reducing what comes back to one word.
 *
 * Kept out of `checkout-form.tsx` for two reasons. The form is already the
 * largest file in the storefront, and this is a lifecycle rather than a piece
 * of it: a script fetched from a third-party origin, a promise that may never
 * settle because the page navigated away underneath it, and three success
 * shapes that all mean "ask the server".
 *
 * Imported dynamically by both callers — the checkout form and the order status
 * page — so the SDK stays out of the initial bundle. That matters more than
 * usual here: merely importing the package injects the sdk.cashfree.com script
 * tag at module-evaluation time, so a static import would load a payment SDK
 * for every shopper who never chooses to pay online.
 */

export type PaymentOutcome =
  /** The shopper finished, or was sent somewhere that will finish it. */
  | "settled"
  /** Closed the window without paying. Nothing is charged, and they can retry. */
  | "dismissed"
  /** The SDK itself would not load or run. Distinct from a declined payment. */
  | "unavailable";

export interface OpenPaymentArgs {
  paymentSessionId: string;
  mode: "sandbox" | "production";
}

/**
 * Opens the payment modal and waits for it to close.
 *
 * The return value decides what the *page* does next, never what the order
 * says: "settled" means stop waiting and go ask the server, not that money
 * arrived. Cashfree's own record is the only thing allowed to answer that, and
 * `reconcilePayment` is what asks it.
 *
 * Deliberately resolves rather than throws on every path. A payment that could
 * not be opened and a payment the shopper walked away from lead to the same
 * place — the order status page, where the retry lives — and a thrown error at
 * this point would only be a second thing for the form to handle on the way
 * there.
 */
export async function openCashfreeCheckout({
  paymentSessionId,
  mode,
}: OpenPaymentArgs): Promise<PaymentOutcome> {
  let cashfree;

  try {
    const { load } = await import("@cashfreepayments/cashfree-js");
    cashfree = await load({ mode });
  } catch {
    // The script is blocked, offline, or failed its three internal retries.
    return "unavailable";
  }

  // Their loader resolves to null when there is no `window`, which cannot
  // happen here — but the type says it can, and a crash inside a payment flow
  // is the worst place to find out the type was right.
  if (!cashfree) return "unavailable";

  try {
    const result = await cashfree.checkout({
      paymentSessionId,
      // The whole reason to use the SDK rather than a redirect: the shopper
      // stays on hazestudios.com and the URL bar keeps saying so while they
      // type a card number. Some methods — UPI intent, a few 3DS flows —
      // navigate away regardless, which is what `redirect` below reports and
      // what the order's return_url catches.
      redirectTarget: "_modal",
    });

    // A `redirect` means the browser is already leaving; nothing after this
    // will run reliably, and the return URL takes over.
    if (result?.redirect) return "settled";

    // An `error` here covers a declined card and a shopper closing the modal
    // alike — the SDK does not reliably distinguish them, and neither needs to
    // be: both leave an unpaid order whose status page offers another go.
    if (result?.error) return "dismissed";

    return "settled";
  } catch {
    return "dismissed";
  }
}
