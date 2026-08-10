/**
 * Types for `@cashfreepayments/cashfree-js`, which ships none.
 *
 * The published package is a four-kilobyte loader with no `types` field and no
 * `.d.ts` anywhere in it — under `strict`, importing it is a compile error
 * rather than an `any`. So the surface this app actually uses is declared here,
 * narrowly and on purpose: the real SDK is fetched at runtime from
 * sdk.cashfree.com and can grow options this file does not know about, and a
 * declaration that guessed at all of them would be fiction with a type
 * signature.
 *
 * Everything here is checked against their v3 JS integration docs and the
 * loader's own source in node_modules.
 */
declare module "@cashfreepayments/cashfree-js" {
  export interface CashfreeLoadOptions {
    /** Their word for our `live` is `production`. See lib/cashfree/config.ts. */
    mode: "sandbox" | "production";
  }

  export interface CashfreeCheckoutOptions {
    /** Minted server-side by POST /pg/orders. Scoped to one order and amount. */
    paymentSessionId: string;
    /**
     * `_modal` keeps the shopper on our page; `_self` navigates away to their
     * hosted page; `_blank` opens a tab.
     */
    redirectTarget?: "_self" | "_blank" | "_top" | "_modal";
  }

  /**
   * What `checkout()` resolves to.
   *
   * Every field is optional because exactly one of them is present per outcome,
   * and which one is the result: `error` for a declined or aborted payment,
   * `paymentDetails` for a completed one, `redirect` when the method navigated
   * away and the answer will arrive at the return URL instead.
   *
   * None of it is trusted for anything but deciding what to show. Whether money
   * moved is settled server-side against Cashfree's own record.
   */
  export interface CashfreeCheckoutResult {
    error?: { message?: string; code?: string; type?: string };
    redirect?: boolean;
    paymentDetails?: { paymentMessage?: string; [k: string]: unknown };
  }

  export interface Cashfree {
    checkout(options: CashfreeCheckoutOptions): Promise<CashfreeCheckoutResult>;
  }

  /** Resolves to null when called on the server, by design in their loader. */
  export function load(options: CashfreeLoadOptions): Promise<Cashfree | null>;
}
