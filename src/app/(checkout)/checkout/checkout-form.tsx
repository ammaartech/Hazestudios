"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Lock } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getLanding, getSessionKey, track } from "@/lib/analytics/track";
// From `checkout-totals`, not `checkout`: the latter reaches for the request
// through the Supabase server client and cannot be pulled into this bundle.
import { quoteTotals } from "@/lib/shop/checkout-totals";
import type { CheckoutPrefill, CheckoutSettings } from "@/lib/shop/checkout-totals";
import type { Cart } from "@/lib/shop/cart";
import type { Country } from "@/lib/shop/countries";
import {
  isPrepaidMethod,
  NO_PAYMENT_METHOD,
  type PaymentMethodOption,
} from "@/lib/shop/payment-methods";
import { DEFAULT_COUNTRY } from "@/lib/shop/countries";
import { hasDialCode } from "@/lib/shop/phone-codes";
import {
  emailProblem,
  isLookupablePin,
  phoneProblem,
  postalCodeProblem,
  requiredProblem,
} from "@/lib/shop/validate";
import {
  removeLine,
  setLineQuantity,
  setLineVariant,
  type CartResult,
} from "@/app/(shop)/cart/actions";
import { placeOrder, quoteDiscount, resolvePincode } from "./actions";
import type { CheckoutState, DiscountQuote } from "./actions";
import {
  AddressBook,
  AddressLabelField,
  CheckboxField,
  Field,
  PhoneField,
  RadioField,
  Section,
  SelectField,
} from "./fields";
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
  cart: initialCart,
  settings,
  prefill,
  countries,
  paymentMethods,
}: {
  cart: Cart;
  settings: CheckoutSettings;
  prefill: CheckoutPrefill;
  countries: Country[];
  paymentMethods: PaymentMethodOption[];
}) {
  const [state, formAction, submitting] = useActionState<CheckoutState, FormData>(
    placeOrder,
    { error: null, field: null }
  );

  const [quote, setQuote] = useState<DiscountQuote | null>(null);
  const [quoting, startQuoting] = useTransition();
  const [billingSame, setBillingSame] = useState(true);

  /* The bag is editable here, so it is state rather than a prop read straight
     through. Every cart action answers with the freshly resolved cart, so this
     is replaced with server truth after each edit — never patched optimistically
     from what the browser guessed, because stock is the server's to know. */
  const [cart, setCart] = useState(initialCart);
  const [editing, startEditing] = useTransition();
  const [editError, setEditError] = useState<string | null>(null);
  const router = useRouter();

  /* Country, PIN, city and state are lifted out of their inputs because the PIN
     lookup writes to three of them and the phone rules depend on the fourth.
     Everything else on this form is still uncontrolled — a field nobody else
     reads has no reason to re-render the page on every keystroke. */
  const [country, setCountry] = useState(
    prefill.address.country || DEFAULT_COUNTRY
  );
  const [postalCode, setPostalCode] = useState(prefill.address.postal_code ?? "");
  const [city, setCity] = useState(prefill.address.city ?? "");
  const [province, setProvince] = useState(prefill.address.province ?? "");

  /* The address book.

     `selectedAddress` is the id of the saved address in use, or null for "a
     different address" — which is also the only state a guest can be in, since
     the book is empty for them.

     The delivery fields that nothing else reads (name, street) stay
     uncontrolled, so picking a saved address re-seeds them by remounting the
     section under a new `key` rather than by turning six more inputs into
     state. `addressSeed` is that key, and `seeded` is what it re-seeds from. */
  const saved = prefill.addresses;
  const [selectedAddress, setSelectedAddress] = useState<string | null>(
    saved[0]?.id ?? null
  );
  const [seeded, setSeeded] = useState(() => ({
    first_name: prefill.address.first_name || prefill.firstName,
    last_name: prefill.address.last_name || prefill.lastName,
    address1: prefill.address.address1 ?? "",
    address2: prefill.address.address2 ?? "",
    phone: saved[0]?.phone || prefill.phone,
  }));
  const [addressSeed, setAddressSeed] = useState(0);

  /* Only asked when the address is new. Re-labelling a saved one is a job for
     the account page, not a decision to put in front of someone checking out. */
  const [addressLabel, setAddressLabel] = useState("Home");

  /* Tagged with the PIN it belongs to, so "which PIN is this about?" is answered
     by the value rather than by an effect racing to clear it. A result whose pin
     no longer matches what is typed is simply not rendered — which means editing
     the field cannot leave a stale "Bengaluru, Karnataka" underneath it. */
  const [lookup, setLookup] = useState<
    | { pin: string; status: "loading" | "failed" }
    | { pin: string; status: "found"; area: string }
    | null
  >(null);

  /* The phone's country is its own value, not a read of the delivery country:
     people living abroad order to an Indian address on an Indian number, and
     the reverse. It *follows* the delivery country when that changes, because
     a shopper switching to Australia almost never wants to keep +91 — but from
     then on it is theirs to set. */
  const [phoneCountry, setPhoneCountry] = useState(
    prefill.address.country || DEFAULT_COUNTRY
  );

  const attribution = useRef<HTMLDivElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  /** The last PIN whose lookup was applied — see the effect below. */
  const resolved = useRef("");

  /* The payment method is the one control on this form that changes the bill,
     so it is the one control the summary has to hear about. Everything else
     here can stay uncontrolled.

     Starts empty on purpose — see `NO_PAYMENT_METHOD`. Nothing is checked
     until the shopper checks it, which is what makes the totals below a
     running answer to a question they are being asked rather than a receipt
     for a decision that was made for them. */
  const [paymentMethod, setPaymentMethod] = useState(NO_PAYMENT_METHOD);
  const chosen = paymentMethod !== NO_PAYMENT_METHOD;

  /* The summary's grid cell, and whether it has already made its one move —
     see `choosePayment`. A ref rather than state for the flag: nothing renders
     from it, and it must be readable inside the handler that sets it. */
  const summaryColumn = useRef<HTMLDivElement>(null);
  const swapped = useRef(false);

  /* The other three blocks of the swap, so the cascade can reach them. */
  const fieldsColumn = useRef<HTMLDivElement>(null);
  const paymentBlock = useRef<HTMLDivElement>(null);
  const commitBlock = useRef<HTMLDivElement>(null);

  /* Priced per method rather than once, because the radio cards each quote
     their own effect on the total. Three calls to a pure function on a handful
     of numbers — cheaper than the state that would avoid them. */
  const priceFor = useMemo(() => {
    const discount = quote?.ok ? quote.amount : 0;
    const freeShipping = Boolean(quote?.ok && quote.freeShipping);
    return (method: string) =>
      quoteTotals(cart.subtotal, discount, settings, freeShipping, method);
  }, [cart.subtotal, quote, settings]);

  const totals = priceFor(paymentMethod);

  /* What each card says on its right-hand edge. Both are stated as what this
     choice does to *this* order — a shopper comparing "− ₹64.95" against
     "+ ₹49" is comparing two real numbers about their own bag, which is a far
     more honest nudge than "5% off" against nothing. */
  const methodOptions = useMemo(
    () =>
      paymentMethods.map((method) => {
        const priced = priceFor(method.value);
        const saving = priced.prepaidDiscount;
        const fee = priced.codFee;

        return {
          ...method,
          badge: saving > 0 ? "Save 5%" : null,
          priceNote:
            saving > 0
              ? `−${formatMoney(saving, cart.currency)}`
              : fee > 0
                ? `+${formatMoney(fee, cart.currency)}`
                : null,
          priceIsSaving: saving > 0,
        };
      }),
    [paymentMethods, priceFor, cart.currency]
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

  /* PIN code → city and state.

     Debounced, because the sixth digit of a PIN arrives while the shopper is
     still typing and firing on each keystroke would spend six requests to
     answer one question. `resolved` stops a filled PIN being looked up again on
     every unrelated re-render, and — more importantly — stops the answer
     overwriting a city the shopper deliberately corrected afterwards. */
  useEffect(() => {
    const pin = postalCode.trim();
    if (!isLookupablePin(pin, country) || resolved.current === pin) return;

    let cancelled = false;

    // Every `setLookup` below runs inside the timer or after an await, never in
    // the effect body — a synchronous set here would re-render on the way into
    // the effect, which is the cascade `react-hooks/set-state-in-effect` warns
    // about. The debounce this needs anyway makes that free.
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setLookup({ pin, status: "loading" });

      const area = await resolvePincode(pin);
      if (cancelled) return;

      if (!area) {
        // Not fatal: an unrecognised PIN is still a PIN the courier may know,
        // so the fields stay editable and nothing is blocked.
        setLookup({ pin, status: "failed" });
        return;
      }

      resolved.current = pin;
      setCity(area.city);
      setProvince(area.province);
      setLookup({ pin, status: "found", area: `${area.city}, ${area.province}` });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [postalCode, country]);

  // Only ever the answer to the PIN currently in the box.
  const pinLookup = lookup?.pin === postalCode.trim() ? lookup : null;

  /**
   * Picking an address out of the book, or choosing to type a new one.
   *
   * `resolved.current` is cleared so the PIN lookup treats the incoming
   * postcode as fresh — without that, selecting an address whose PIN was
   * already looked up this session would leave the confirmation line stale.
   */
  function selectAddress(id: string | null) {
    setSelectedAddress(id);

    const address = id ? saved.find((entry) => entry.id === id) : null;

    setSeeded({
      first_name: address?.first_name ?? "",
      last_name: address?.last_name ?? "",
      address1: address?.address1 ?? "",
      address2: address?.address2 ?? "",
      phone: address?.phone ?? "",
    });
    setCity(address?.city ?? "");
    setProvince(address?.province ?? "");
    setPostalCode(address?.postal_code ?? "");
    if (address?.country) {
      setCountry(address.country);
      if (hasDialCode(address.country)) setPhoneCountry(address.country);
    }

    resolved.current = "";
    setLookup(null);
    // Remounts the uncontrolled inputs so they pick up the new defaults.
    setAddressSeed((n) => n + 1);
  }

  /**
   * The swap's motion: one settle per block, top to bottom, like the card
   * landing and the weight of it travelling down the page.
   *
   * Each block starts a few pixels above where it belongs and eases down into
   * it, and each one starts a little after the one above — so the eye reads a
   * sequence rather than four things twitching at once. Only the summary
   * fades; the rest are already on screen and fading them would look like the
   * page reloading rather than reacting.
   *
   * Transforms and opacity only. Nothing here changes layout, which is the
   * whole reason it can be this liberal — the positions were settled
   * synchronously before any of this runs, and this is decoration over a page
   * that has already stopped moving.
   *
   * Two things it deliberately does not do:
   *
   * Animate the real distance travelled. The summary moves about 1,300px down
   * the document, and playing that literally is a streak across the screen at
   * two thousand pixels a second. What sells "it came from up there" is a
   * short descent with a long settle, not an accurate one. (A full-length
   * version of this was built and thrown away: the card and the address fields
   * have very different distances to cover, so they come apart mid-flight and
   * leave the viewport half empty. Fixing that costs a held position, a capped
   * travel and a stack of timing that all has to stay in sync with a layout
   * nobody promised to keep. Not worth it for a second of scenery.)
   *
   * Animate what cannot be seen. To have tapped a payment method the shopper
   * is near the end of the form, so the blocks above are off-screen — and
   * transforming a 1,300px subtree of live inputs costs a compositor layer to
   * animate nothing anybody is looking at. Blocks outside the viewport keep
   * their slot in the rhythm and are simply skipped.
   */
  function cascade(summary: HTMLElement) {
    const steps: { el: HTMLElement | null; from: number; fade?: boolean }[] = [
      { el: fieldsColumn.current, from: -6 },
      { el: summary, from: -34, fade: true },
      { el: paymentBlock.current, from: -10 },
      { el: commitBlock.current, from: -14 },
    ];

    steps.forEach(({ el, from, fade }, index) => {
      if (!el) return;

      const box = el.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) return;

      el.animate(
        fade
          ? [
              { transform: `translateY(${from}px) scale(0.985)`, opacity: 0 },
              // Solid well before it has finished moving, so most of what the
              // shopper watches is a card settling rather than one appearing.
              { opacity: 1, offset: 0.45 },
              { transform: "none", opacity: 1 },
            ]
          : [{ transform: `translateY(${from}px)` }, { transform: "none" }],
        {
          duration: fade ? 620 : 540,
          delay: index * 95,
          // The curve the rest of this checkout eases with: quick off the mark,
          // then a long, slowing arrival. It is what makes a 34px move read as
          // unhurried instead of abrupt.
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "backwards",
        }
      );
    });
  }

  /**
   * Picking a payment method, and the swap that comes with it.
   *
   * On a phone the summary starts at the top of the form and drops into the
   * slot directly above the payment cards — so the total, the method and the
   * button that commits both sit in one screenful, and nobody has to scroll
   * back to the top to check what they are about to buy. The choice of payment
   * is the right moment for it: the point where the form stops asking what
   * they want and starts asking whether they are sure.
   *
   * Landing *above* the payment section rather than below it has a property
   * worth keeping: the summary leaves the space above the address fields and
   * takes up the same space immediately before Payment, so the payment cards
   * do not move at all. The shopper's thumb is on one of them.
   *
   * Three things have to happen in the right order for that to feel like one
   * motion rather than the page falling over:
   *
   * 1. `flushSync` commits the reorder immediately, inside this handler, so the
   *    two measurements below straddle it. Without it React would batch the
   *    render to after this function returns and the "before" and "after"
   *    positions would be the same number.
   *
   * 2. The scroll is corrected by however far the payment section moved. A tall
   *    block leaving the space above the viewport drags everything up with it,
   *    which would fling the shopper down the page at the exact moment they
   *    touched a control. Correcting it here — synchronously, before the
   *    browser paints — means the section they are looking at does not move at
   *    all. (It can under-correct if they are near the top of the document and
   *    there is not that much scroll to give back. On a form this long, by the
   *    time the payment section is on screen, there is.)
   *
   * 3. Only then does the summary animate, and only into its arrival. What it
   *    actually did was travel a thousand pixels from off-screen, and playing
   *    that literally would be a cartoon; what the shopper perceives is a card
   *    settling into a space that just opened for it.
   *
   * Runs once, ever. Switching between the two methods afterwards re-prices the
   * order and moves nothing, because the summary is already where it belongs
   * and re-animating a card the shopper is reading is a distraction, not
   * polish.
   */
  function choosePayment(next: string) {
    const group = document.getElementById("payment_method");
    const column = summaryColumn.current;

    // Desktop keeps the summary in its own sticky column, so there is nothing
    // to move and the `lg:` placement below would override it anyway.
    const swapping =
      !swapped.current &&
      column != null &&
      !window.matchMedia("(min-width: 64rem)").matches;

    if (!swapping) {
      setPaymentMethod(next);
      return;
    }

    swapped.current = true;
    const before = group?.getBoundingClientRect().top ?? 0;

    flushSync(() => setPaymentMethod(next));

    const drift = (group?.getBoundingClientRect().top ?? before) - before;
    if (drift) window.scrollBy(0, drift);

    // Measured before the animation starts, or the transform below would be
    // baked into the answer.
    const landed = column.getBoundingClientRect();

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cascade(column);
    }

    /* Landing directly above the payment card usually means it is already on
       screen, and moving the page under someone who just tapped a control is
       worse than leaving it. Only when it landed wholly outside the viewport
       is there a "where did it go" to answer, and `nearest` answers it with
       the smallest scroll that works. */
    const offScreen =
      landed.bottom < 72 || landed.top > window.innerHeight - 96;
    if (offScreen) {
      column.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  /**
   * Sends the shopper to the one question they have not answered.
   *
   * Looks the fieldset up by id the same way the error effect does — the group
   * carries `id="payment_method"` precisely so both can find it — and focuses
   * it rather than the first radio, so a keyboard user lands on the group and
   * arrows into it instead of having one option quietly selected on arrival.
   */
  function focusPayment() {
    const group = document.getElementById("payment_method");
    group?.scrollIntoView({ block: "center", behavior: "smooth" });
    group?.focus({ preventScroll: true });
  }

  function applyDiscount(code: string) {
    startQuoting(async () => {
      setQuote(await quoteDiscount(code, cart.subtotal));
    });
  }

  /* Line edits.

     All three funnel through here so the empty-bag case is handled once: a
     shopper who removes their last item is standing on a checkout with nothing
     to buy, and the bag is the page that explains that. `router.replace` rather
     than `push`, so the back button does not return them to a dead checkout. */
  function runEdit(action: () => Promise<CartResult>) {
    setEditError(null);
    startEditing(async () => {
      const result = await action();
      setCart(result.cart);
      if (!result.ok) setEditError(result.error);
      if (result.cart.lines.length === 0) router.replace("/cart");
    });
  }

  return (
    /* Three grid items on mobile, stacked, and the middle one moves — see
       `choosePayment`. On desktop the explicit col/row placement below pins
       all three regardless of the `order` classes, so the swap is a phone
       behaviour that costs the two-column layout nothing.

       `lg:gap-y-0` because the desktop grid gained a second row that the old
       single-row version never had, and a 3.5rem row gap between the fields
       and the button they submit is not the spacing that was there before.
       The commit block carries its own margin instead.

       `overflow-anchor: none` because the swap has to behave the same on every
       phone. Chrome and Firefox implement scroll anchoring and would silently
       correct for the reorder themselves; Safari implements none of it and
       would not. Left on, the two corrections compose — the browser's, then
       ours — and the section under the shopper's thumb ends up ~20px from
       where it was, which is precisely the jitter this is all trying to avoid.
       Turning it off inside this form makes `choosePayment` the only thing
       moving the page, and it moves it identically everywhere. */
    <form
      action={formAction}
      className="mx-auto grid max-w-6xl gap-8 px-4 py-8 [overflow-anchor:none] md:px-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-x-14 lg:gap-y-0 lg:py-12"
    >
      {/* ------------------------------------------------------------------ */}
      {/* Fields                                                              */}
      {/* ------------------------------------------------------------------ */}
      <div
        ref={fieldsColumn}
        className="order-2 min-w-0 lg:order-0 lg:col-start-1 lg:row-start-1"
      >
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
            validate={emailProblem}
            inputMode="email"
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

          {/* Pre-ticked, on the merchant's instruction. Worth knowing what that
              trades: it collects more addresses and fewer readers, and a
              pre-ticked box is not valid consent under GDPR at all — so if this
              store ever markets into the EU or UK, those addresses cannot
              lawfully be mailed and this has to go back to unchecked. The box
              stays visible and adjacent to the label rather than buried, which
              is the part that keeps it honest either way. */}
          <CheckboxField
            name="marketing_opt_in"
            label="Email me about new drops and restocks"
            hint="No more than a few times a season. Unsubscribe whenever."
            defaultChecked
          />
        </Section>

        <Section title="Delivery">
          {/* Only a signed-in shopper has a book, and it is only worth showing
              once there is something in it. */}
          {saved.length > 0 && (
            <AddressBook
              addresses={saved}
              selectedId={selectedAddress}
              onSelect={selectAddress}
            />
          )}

          {/* Keyed so choosing a saved address re-seeds the uncontrolled inputs
              below — see `selectAddress`.

              The prefix matters. This and the phone field are siblings in the
              same children list and both remount on the same counter, so a bare
              `key={addressSeed}` gave two children the key `"0"` — and React's
              documented response to a duplicate key is to duplicate or omit
              children, which it did: the name and address fields rendered over
              and over down the page. */}
          <div key={`delivery-${addressSeed}`} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="First name"
                name="first_name"
                autoComplete="given-name"
                required
                defaultValue={seeded.first_name}
                validate={(value) => requiredProblem(value, "Enter a first name.")}
                invalid={state.field === "first_name"}
              />
              <Field
                label="Last name"
                name="last_name"
                autoComplete="family-name"
                required
                defaultValue={seeded.last_name}
                validate={(value) => requiredProblem(value, "Enter a last name.")}
                invalid={state.field === "last_name"}
              />
            </div>

            <Field
              label="Address"
              name="address1"
              autoComplete="address-line1"
              required
              defaultValue={seeded.address1}
              validate={(value) => requiredProblem(value, "Enter a street address.")}
              invalid={state.field === "address1"}
            />
            <Field
              label="Apartment, suite, etc."
              name="address2"
              autoComplete="address-line2"
              defaultValue={seeded.address2}
            />
          </div>

          {/* Postal code leads the row, against the usual city-first ordering,
              because for an Indian address it is the field that answers the
              other two. Filling it first means the shopper types six digits
              instead of three fields. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={country === "IN" ? "PIN code" : "Postal code"}
              name="postal_code"
              autoComplete="postal-code"
              required
              value={postalCode}
              onChange={setPostalCode}
              validate={(value) => postalCodeProblem(value, country)}
              inputMode={country === "IN" ? "numeric" : "text"}
              maxLength={country === "IN" ? 6 : 32}
              busy={pinLookup?.status === "loading"}
              invalid={state.field === "postal_code"}
            />
            <Field
              label="City"
              name="city"
              autoComplete="address-level2"
              required
              value={city}
              onChange={setCity}
              validate={(value) => requiredProblem(value, "Enter a city.")}
              invalid={state.field === "city"}
            />
            <Field
              label="State"
              name="province"
              autoComplete="address-level1"
              required
              value={province}
              onChange={setProvince}
              validate={(value) =>
                requiredProblem(value, "Enter a state or province.")
              }
              invalid={state.field === "province"}
            />
          </div>

          {/* The lookup's own voice. A field that silently changes under the
              shopper is unsettling; saying what was found and why makes it an
              action they can see and correct. */}
          {pinLookup?.status === "found" && (
            <p className="flex items-center gap-2 text-xs text-(--shop-success)">
              <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
              {pinLookup.area} — filled in from your PIN code. Edit if it&rsquo;s
              wrong.
            </p>
          )}
          {pinLookup?.status === "failed" && (
            <p className="text-xs text-(--shop-mute)">
              We couldn&rsquo;t look that PIN code up. Please fill in your city and
              state yourself.
            </p>
          )}

          <SelectField
            label="Country / region"
            name="country"
            required
            value={country}
            onChange={(next) => {
              setCountry(next);
              // See `phoneCountry` above: the dialling code follows the
              // delivery country, and stays wherever the shopper puts it after.
              if (hasDialCode(next)) setPhoneCountry(next);
            }}
            options={countries.map((c) => ({ value: c.code, label: c.name }))}
            invalid={state.field === "country"}
          />

          {/* Required, not just for delivery updates: Qikink's create-order
              call rejects an order with no phone number outright, so a
              shopper who skips this here would otherwise find out only when
              the print push silently fails. The copy stays honest about why
              it's being asked rather than implying it feeds marketing. */}
          <PhoneField
            key={`phone-${addressSeed}`}
            label="Phone"
            name="phone"
            countryName="phone_country"
            countryValue={phoneCountry}
            onCountryChange={setPhoneCountry}
            countries={countries}
            required
            defaultValue={seeded.phone}
            validate={(value) => phoneProblem(value, phoneCountry)}
            invalid={state.field === "phone"}
            hint={
              phoneCountry === "IN"
                ? "10-digit mobile number. The courier calls this before delivery."
                : "For delivery updates only."
            }
          />

          {/* Asked only for an address the book does not already hold, and only
              of someone who has an account to save it to. A guest's address is
              still remembered against their email — they simply have nowhere to
              see it until they sign up, so naming it would be a question with
              no visible consequence. */}
          {prefill.signedIn && selectedAddress === null && (
            <AddressLabelField value={addressLabel} onChange={setAddressLabel} />
          )}

          {/* Reordering to a saved address must not rename it. `place_order`
              re-labels on conflict — which is right when the shopper just told
              us what to call the place, and wrong if we said nothing and let it
              fall back to "Home". So the existing label rides along. */}
          {selectedAddress !== null && (
            <input
              type="hidden"
              name="address_label"
              value={saved.find((entry) => entry.id === selectedAddress)?.label ?? ""}
            />
          )}
        </Section>

        {/* Hidden, and populated after mount — see the effect above. Kept with
            the fields rather than beside the button: it is part of what this
            column submits, and it renders nothing either way. */}
        <div ref={attribution} hidden>
          <input type="hidden" name="session_key" defaultValue="" />
          <input type="hidden" name="landing_path" defaultValue="" />
          <input type="hidden" name="referrer" defaultValue="" />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Summary                                                             */}
      {/* ------------------------------------------------------------------ */}
      {/* Between the delivery fields and the payment choice in the DOM, which
          is the order the keyboard and a screen reader take: contact →
          delivery → what it costs → how to pay → place it.

          Visually it starts *above* all of that on a phone, because a shopper
          wants to see what they are buying before they type an address. The
          moment they pick a payment method it drops into the slot it holds in
          the DOM, directly above the payment card they just touched — so the
          total, the method and the button that commits both end up in one
          screenful, and nobody has to scroll back to the top to check what
          they are about to buy. See `choosePayment`. */}
      <div
        ref={summaryColumn}
        className={cn(
          "lg:order-0 lg:col-start-2 lg:row-start-1 lg:row-span-3",
          chosen ? "order-3" : "order-1"
        )}
      >
        <OrderSummary
          cart={cart}
          totals={totals}
          prepaidSaving={priceFor("prepaid").prepaidDiscount}
          codFee={priceFor("cod").codFee}
          methodChosen={chosen}
          quote={quote}
          applying={quoting}
          onApply={applyDiscount}
          editing={editing}
          editError={editError}
          onLineQuantity={(lineId, quantity) =>
            runEdit(() => setLineQuantity(lineId, quantity))
          }
          onLineVariant={(lineId, variantId) =>
            runEdit(() => setLineVariant(lineId, variantId))
          }
          onLineRemove={(lineId) => runEdit(() => removeLine(lineId))}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Payment                                                             */}
      {/* ------------------------------------------------------------------ */}
      {/* Its own grid item, so the summary has a slot to land in between this
          and the address above it. `mt-2` against the grid's 2rem row gap
          restores the 2.5rem `Section` gives itself when it has siblings;
          desktop has no row gap, so it takes the margin outright. */}
      <div
        ref={paymentBlock}
        className="order-4 mt-2 lg:order-0 lg:col-start-1 lg:row-start-2 lg:mt-10"
      >
        <Section title="Payment">
          {/* The answer routes the order and prices it. Only COD is auto-sent
              to the printer, map.ts reports the order as COD or Prepaid on the
              strength of it, and since 0022 the choice is worth real money in
              both directions — see payment-methods.ts for the two numbers. */}
          <RadioField
            label="How would you like to pay?"
            name="payment_method"
            options={methodOptions}
            value={paymentMethod}
            onChange={choosePayment}
            /* Always a line, never absent, and short enough to stay one line
               on the narrowest phone. A hint that unmounts on selection takes
               22px of document with it, and the payment section sits close
               enough to the end of the form that the shopper is usually
               scrolled to the very bottom when they tap — where there is no
               scroll left to give back and the whole page drops instead. The
               swap is engineered not to move anything; this would have moved
               it anyway. */
            hint={
              chosen
                ? "You can change this until you place the order."
                : "Pick one to see your final total."
            }
          />

          {/* The gateway is not live yet, and a shopper who picks prepaid has
              earned the right to know that before they commit rather than
              after. Saying what happens next is also the difference between an
              order that gets paid and one that sits pending: without this line
              there is nothing on screen telling them a link is coming. */}
          {isPrepaidMethod(paymentMethod) && (
            <p
              role="status"
              className="rounded-2xl bg-(--shop-success)/8 px-4 py-3 text-xs text-(--shop-charcoal)"
            >
              We&rsquo;ll send a secure payment link to your email and phone as
              soon as this order is placed. Your {formatMoney(
                totals.prepaidDiscount,
                cart.currency
              )}{" "}
              saving is already in the total below — nothing is charged on this
              page.
            </p>
          )}

          <p className="flex items-center gap-2 text-xs text-(--shop-mute)">
            <Lock className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            Your details are sent over an encrypted connection.
          </p>

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
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Commit                                                              */}
      {/* ------------------------------------------------------------------ */}
      {/* Its own grid item for the same reason Payment is. `mt-2` against the
          grid's 2rem row gap comes to the 2.5rem this block had as `mt-10`
          when it lived inside the fields column; desktop has no row gap, so it
          keeps the margin outright. */}
      <div
        ref={commitBlock}
        className="order-5 mt-2 lg:order-0 lg:col-start-1 lg:row-start-3 lg:mt-10"
      >
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

        {/* Two buttons' worth of behaviour in one control.

            Until a method is picked there is no final total to put on it, so
            quoting one would be quoting a number that is about to move. It
            becomes a plain button that sends the shopper to the decision
            instead — not disabled, because a disabled button pressed by
            someone who cannot see why is a dead end, and this one answers.

            The server action rejects an empty method regardless, which is
            what happens with JavaScript off; this only saves the round trip
            and the scroll back up. */}
        <button
          type={chosen ? "submit" : "button"}
          onClick={chosen ? undefined : focusPayment}
          disabled={submitting}
          className="glass glass-pill glass-press glass-primary flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 px-8 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--shop-ink) disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            "Placing your order…"
          ) : chosen ? (
            <>
              Place order · {formatMoney(totals.total, cart.currency)}
              <ArrowRight className="size-4" aria-hidden />
            </>
          ) : (
            <>
              Choose how to pay
              <ArrowRight className="size-4" aria-hidden />
            </>
          )}
        </button>

        <p className="mt-4 text-center text-xs text-(--shop-mute)">
          By placing this order you agree to our terms of sale.
        </p>
      </div>
    </form>
  );
}
