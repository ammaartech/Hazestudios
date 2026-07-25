"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { getLanding, getSessionKey, track } from "@/lib/analytics/track";
// From `checkout-totals`, not `checkout`: the latter reaches for the request
// through the Supabase server client and cannot be pulled into this bundle.
import { quoteTotals } from "@/lib/shop/checkout-totals";
import type { CheckoutPrefill, CheckoutSettings } from "@/lib/shop/checkout-totals";
import type { Cart } from "@/lib/shop/cart";
import type { Country } from "@/lib/shop/countries";
import { placeOrder, quoteDiscount } from "./actions";
import type { CheckoutState, DiscountQuote } from "./actions";
import { CheckboxField, Field, Section, SelectField } from "./fields";
import { OrderSummary } from "./order-summary";

/**
 * The checkout form.
 *
 * One `<form>` spanning both columns, so the discount field in the summary and
 * the address fields beside it are the same submission — no hidden mirroring,
 * no second form nested inside the first.
 *
 * Nine fields is the whole thing. Every one either has to be on a parcel or is
 * the single most valuable thing a store can hold: the email address. Anything
 * that could be inferred later (how they heard about us, date of birth, a
 * survey) is left out — the shop already learns their taste from what they
 * bought, their location from where it shipped, and their campaign from the
 * attribution stamped on the order. Asking is the expensive way to find out.
 */
export function CheckoutForm({
  cart,
  settings,
  prefill,
  countries,
}: {
  cart: Cart;
  settings: CheckoutSettings;
  prefill: CheckoutPrefill;
  countries: Country[];
}) {
  const [state, formAction, submitting] = useActionState<CheckoutState, FormData>(
    placeOrder,
    { error: null, field: null }
  );

  const [quote, setQuote] = useState<DiscountQuote | null>(null);
  const [quoting, startQuoting] = useTransition();
  const [billingSame, setBillingSame] = useState(true);

  const attribution = useRef<HTMLDivElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);

  const totals = useMemo(
    () =>
      quoteTotals(
        cart.subtotal,
        quote?.ok ? quote.amount : 0,
        settings,
        Boolean(quote?.ok && quote.freeShipping)
      ),
    [cart.subtotal, quote, settings]
  );

  /* Reaching checkout is the funnel step before purchase, and 0007 has been
     waiting to record it. Fires once per mount, not per re-render. */
  useEffect(() => {
    track("checkout_start", { value: cart.subtotal });
  }, [cart.subtotal]);

  /* Attribution lives in sessionStorage, which the server cannot read. Filling
     hidden inputs after mount is how it reaches the action — and if JavaScript
     never runs, the fields stay empty and the order is placed without campaign
     data rather than not placed at all. */
  useEffect(() => {
    const root = attribution.current;
    if (!root) return;

    const { landingPath, referrer } = getLanding();
    const values: Record<string, string> = {
      session_key: getSessionKey() ?? "",
      landing_path: landingPath,
      referrer,
    };

    for (const [name, value] of Object.entries(values)) {
      const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (input) input.value = value;
    }
  }, []);

  /* A failure that scrolled off the top is a failure the shopper cannot see.
     Focus goes to the named field when there is one, and to the message
     otherwise — either way it is announced and in view. */
  useEffect(() => {
    if (!state.error) return;

    const target = state.field
      ? document.getElementById(state.field)
      : errorBox.current;

    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    target?.focus?.({ preventScroll: true });
  }, [state]);

  function applyDiscount(code: string) {
    startQuoting(async () => {
      setQuote(await quoteDiscount(code, cart.subtotal));
    });
  }

  const country = prefill.address.country || countries[0]?.code || "US";

  return (
    <form
      action={formAction}
      className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:px-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-14 lg:py-12"
    >
      {/* ------------------------------------------------------------------ */}
      {/* Fields                                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="min-w-0">
        <Section
          title="Contact"
          description={
            prefill.signedIn
              ? undefined
              : "We'll send your order confirmation here."
          }
        >
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={prefill.email}
            invalid={state.field === "email"}
          />

          {!prefill.signedIn && (
            <p className="text-sm text-(--shop-mute)">
              Have an account?{" "}
              <Link
                href="/account/login?next=/checkout"
                className="cursor-pointer underline underline-offset-4 transition-colors hover:text-(--shop-ink)"
              >
                Sign in
              </Link>{" "}
              to check out faster.
            </p>
          )}

          {/* Unticked by default, deliberately. A pre-ticked box collects more
              addresses and fewer readers, and in GDPR jurisdictions it is not
              consent at all. Flip `defaultChecked` only where that is lawful. */}
          <CheckboxField
            name="marketing_opt_in"
            label="Email me about new drops and restocks"
            hint="No more than a few times a season. Unsubscribe whenever."
          />
        </Section>

        <Section title="Delivery">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="First name"
              name="first_name"
              autoComplete="given-name"
              required
              defaultValue={prefill.address.first_name || prefill.firstName}
              invalid={state.field === "first_name"}
            />
            <Field
              label="Last name"
              name="last_name"
              autoComplete="family-name"
              required
              defaultValue={prefill.address.last_name || prefill.lastName}
              invalid={state.field === "last_name"}
            />
          </div>

          <Field
            label="Address"
            name="address1"
            autoComplete="address-line1"
            required
            defaultValue={prefill.address.address1}
            invalid={state.field === "address1"}
          />
          <Field
            label="Apartment, suite, etc."
            name="address2"
            autoComplete="address-line2"
            defaultValue={prefill.address.address2}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="City"
              name="city"
              autoComplete="address-level2"
              required
              defaultValue={prefill.address.city}
              invalid={state.field === "city"}
            />
            <Field
              label="State / Province"
              name="province"
              autoComplete="address-level1"
              defaultValue={prefill.address.province}
            />
            <Field
              label="Postal code"
              name="postal_code"
              autoComplete="postal-code"
              defaultValue={prefill.address.postal_code}
            />
          </div>

          <SelectField
            label="Country / region"
            name="country"
            required
            defaultValue={country}
            options={countries.map((c) => ({ value: c.code, label: c.name }))}
            invalid={state.field === "country"}
          />

          {/* Optional, and honest about why it is being asked. A phone number
              given for delivery updates is not a number that consented to
              marketing, and the copy should not blur that. */}
          <Field
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            defaultValue={prefill.phone}
            hint="For delivery updates only."
          />
        </Section>

        <Section
          title="Payment"
          description="All transactions are secure and encrypted."
        >
          {/* No gateway is connected yet. Saying so is the only defensible
              option: a checkout that implies a card was charged and then
              silently creates a pending order is the worst possible version of
              this screen. The order is real, and the store follows up. */}
          <div className="glass glass-on-light rounded-2xl px-5 py-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Lock className="size-4" strokeWidth={2} aria-hidden />
              Pay on confirmation
            </p>
            <p className="mt-1.5 text-sm text-(--shop-mute)">
              We&apos;ll email you a payment link once your order is confirmed and
              reserved. Nothing is charged now.
            </p>
          </div>

          <CheckboxField
            name="billing_same"
            label="Billing address is the same as delivery"
            defaultChecked
            onChange={setBillingSame}
          />

          {!billingSame && (
            <div className="flex flex-col gap-4 border-l-2 border-(--shop-hairline-soft) pl-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="First name"
                  name="billing_first_name"
                  autoComplete="billing given-name"
                  required
                />
                <Field
                  label="Last name"
                  name="billing_last_name"
                  autoComplete="billing family-name"
                  required
                />
              </div>
              <Field
                label="Address"
                name="billing_address1"
                autoComplete="billing address-line1"
                required
                invalid={state.field === "billing_address1"}
              />
              <Field
                label="Apartment, suite, etc."
                name="billing_address2"
                autoComplete="billing address-line2"
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field
                  label="City"
                  name="billing_city"
                  autoComplete="billing address-level2"
                  required
                />
                <Field
                  label="State / Province"
                  name="billing_province"
                  autoComplete="billing address-level1"
                />
                <Field
                  label="Postal code"
                  name="billing_postal_code"
                  autoComplete="billing postal-code"
                />
              </div>
              <SelectField
                label="Country / region"
                name="billing_country"
                required
                defaultValue={country}
                options={countries.map((c) => ({ value: c.code, label: c.name }))}
              />
            </div>
          )}
        </Section>

        {/* Hidden, and populated after mount — see the effect above. */}
        <div ref={attribution} hidden>
          <input type="hidden" name="session_key" defaultValue="" />
          <input type="hidden" name="landing_path" defaultValue="" />
          <input type="hidden" name="referrer" defaultValue="" />
        </div>

        {/* ---- Commit ---- */}
        <div className="mt-10">
          {state.error && (
            <p
              ref={errorBox}
              role="alert"
              tabIndex={-1}
              className="mb-4 rounded-2xl bg-(--shop-sale)/8 px-4 py-3 text-sm text-(--shop-sale) outline-none"
            >
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="glass glass-pill glass-press glass-ink flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 px-8 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--shop-ink) disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              "Placing your order…"
            ) : (
              <>
                Place order · {formatMoney(totals.total, cart.currency)}
                <ArrowRight className="size-4" aria-hidden />
              </>
            )}
          </button>

          <p className="mt-4 text-center text-xs text-(--shop-mute)">
            By placing this order you agree to our terms of sale.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Summary                                                             */}
      {/* ------------------------------------------------------------------ */}
      {/* Second in the DOM so the keyboard and screen-reader path runs
          contact → delivery → payment → total, and visually first on mobile
          where a shopper wants to confirm what they are buying before typing. */}
      <div className="order-first lg:order-none lg:col-start-2 lg:row-start-1">
        <OrderSummary
          cart={cart}
          totals={totals}
          quote={quote}
          applying={quoting}
          onApply={applyDiscount}
        />
      </div>
    </form>
  );
}
