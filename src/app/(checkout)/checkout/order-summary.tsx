"use client";

import Image from "next/image";
import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Tag, Trash2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatMoney } from "@/lib/format";
import { shortSizeLabel, shortVariantTitle, sortOptionValues } from "@/lib/variants";
import { cn } from "@/lib/utils";
import type { Cart, CartLine } from "@/lib/shop/cart";
import type { CheckoutTotals } from "@/lib/shop/checkout-totals";
import type { DiscountQuote } from "./actions";

/** Ceiling for the quantity picker, before stock is taken into account. */
const QUANTITY_CHOICES = 10;

/**
 * What the shopper is buying and what it costs.
 *
 * Rendered inside the checkout `<form>` rather than beside it, so the discount
 * field is a real form control and submits with everything else. The
 * alternative — its own form, or a hidden mirror of its value — is one more
 * thing that can disagree with what the shopper can see.
 *
 * On desktop it is a sticky column that cannot be collapsed — there is room,
 * and a summary you have to open is a total you have to go looking for. On
 * mobile the same markup is a disclosure, so a shopper on a long bag can fold
 * it away and get to the address fields. Either way the header row carries the
 * total, so collapsing never hides the number that matters.
 *
 * The lines are editable in place — size, quantity and remove all write through
 * to the same cart the order is placed from, so what is shown and what is
 * bought cannot diverge.
 */
export function OrderSummary({
  cart,
  totals,
  prepaidSaving,
  codFee,
  methodChosen,
  quote,
  applying,
  onApply,
  editing,
  editError,
  onLineQuantity,
  onLineVariant,
  onLineRemove,
}: {
  cart: Cart;
  totals: CheckoutTotals;
  /**
   * What switching to prepaid would take off this bag — which is *not*
   * `totals.prepaidDiscount`, since that is zero on the COD order this line is
   * shown to. Computed by the form, which is the only place that can price a
   * method the shopper has not chosen.
   */
  prepaidSaving: number;
  /** What COD would add. Constant, but formatted in the cart's own currency. */
  codFee: number;
  /** False until the shopper picks a method — the total is not final yet. */
  methodChosen: boolean;
  quote: DiscountQuote | null;
  applying: boolean;
  onApply: (code: string) => void;
  /** True while a line edit is in flight — freezes the controls. */
  editing: boolean;
  editError: string | null;
  onLineQuantity: (lineId: string, quantity: number) => void;
  onLineVariant: (lineId: string, variantId: string) => void;
  onLineRemove: (lineId: string) => void;
}) {
  const codeInput = useRef<HTMLInputElement>(null);

  /* Open by default, and on desktop it stays that way — the `lg:` rules below
     force the panel open and take the trigger out of the pointer path, so this
     flag only ever governs the mobile disclosure. */
  const [open, setOpen] = useState(true);
  const panelId = useId();

  const applied = quote?.ok ? quote : null;

  return (
    <aside className="lg:sticky lg:top-8 lg:self-start">
      {/* This was a real `<details>`, which was the right call until it had to
          animate. A closed `<details>` does not merely clip its content — the
          browser stops rendering it, so there is no height to transition from
          and no CSS that can bridge the two states. (`::details-content` plus
          `interpolate-size` can, but neither is safe to rely on across the
          mobile browsers this summary actually collapses on.)

          So the disclosure is owned here instead, and the panel animates on
          `grid-template-rows` between `0fr` and `1fr` — the one technique that
          transitions to intrinsic height without measuring the content first,
          which matters because this panel's height changes whenever a line is
          edited. `aria-expanded` carries the state the `<summary>` used to.

          The content stays mounted while collapsed rather than being unmounted:
          the popovers inside hold state, and on desktop the panel is forced
          open by the `lg:` rules regardless of this flag. */}
      <div className="glass glass-panel overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--shop-ink) lg:pointer-events-none"
        >
          <span className="meta flex items-center gap-2 text-(--shop-mute)">
            Order summary
            <span className="text-(--shop-stone)">
              ({cart.count} {cart.count === 1 ? "item" : "items"})
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span className="text-lg font-medium tabular-nums">
              {formatMoney(totals.total, cart.currency)}
            </span>
            <ChevronDown
              className={cn(
                "size-4 text-(--shop-mute) transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none lg:hidden",
                open && "rotate-180"
              )}
              aria-hidden
            />
          </span>
        </button>

        <div
          id={panelId}
          className={cn(
            "grid transition-[grid-template-rows] motion-reduce:transition-none",
            // Opening is the slower half, closing the quicker one — a panel
            // that leaves faster than it arrives feels responsive rather than
            // sluggish, and there is nothing to read on the way out.
            open
              ? "grid-rows-[1fr] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
              : "grid-rows-[0fr] duration-200 ease-[cubic-bezier(0.4,0,1,1)]",
            // There is room on desktop, and a total you have to open is a total
            // you have to go looking for.
            "lg:grid-rows-[1fr]"
          )}
        >
          {/* The row is what collapses; this is what has to clip while it does. */}
          <div
            className={cn(
              "overflow-hidden transition-opacity motion-reduce:transition-none lg:opacity-100",
              open ? "opacity-100 duration-300 delay-75" : "opacity-0 duration-150"
            )}
          >
            <div className="border-t border-(--shop-ink)/8 px-6 pt-5 pb-6">
              <ul className="flex flex-col gap-5">
                {cart.lines.map((line) => (
                  <SummaryLine
                    key={line.id}
                    line={line}
                    currency={cart.currency}
                    busy={editing}
                    onQuantity={(quantity) => onLineQuantity(line.id, quantity)}
                    onVariant={(variantId) => onLineVariant(line.id, variantId)}
                    onRemove={() => onLineRemove(line.id)}
                  />
                ))}
              </ul>

              {editError && (
                <p role="status" className="mt-3 text-xs text-(--shop-sale)">
                  {editError}
                </p>
              )}

              {/* ---- Discount ---- */}
              <div className="mt-6 border-t border-(--shop-ink)/8 pt-5">
                <div className="flex gap-2">
                  <input
                    ref={codeInput}
                    name="discount_code"
                    aria-label="Discount code"
                    placeholder="Discount code"
                    autoComplete="off"
                    // Enter inside a form submits it. In this field that would place
                    // the order, which is emphatically not what "apply my code"
                    // means — so Enter is intercepted and routed to Apply.
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onApply(event.currentTarget.value);
                      }
                    }}
                    className="glass glass-on-light h-12 min-w-0 flex-1 rounded-2xl px-4 text-[15px] text-(--shop-ink) outline-none transition-shadow duration-300 placeholder:text-(--shop-stone) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)"
                  />
                  <button
                    type="button"
                    disabled={applying}
                    onClick={() => onApply(codeInput.current?.value ?? "")}
                    className="glass glass-on-light glass-pill glass-press h-12 shrink-0 cursor-pointer px-5 text-sm font-medium text-(--shop-ink) disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {applying ? "…" : "Apply"}
                  </button>
                </div>

                {quote?.error && (
                  <p role="status" className="mt-2 text-xs text-(--shop-sale)">
                    {quote.error}
                  </p>
                )}
                {applied && (
                  <p
                    role="status"
                    className="mt-2 flex items-center gap-1.5 text-xs text-(--shop-success)"
                  >
                    <Check className="size-3.5" aria-hidden />
                    {applied.freeShipping
                      ? "Free shipping applied"
                      : `${applied.code.toUpperCase()} applied`}
                  </p>
                )}
              </div>

              {/* ---- Totals ---- */}
              <dl className="mt-5 flex flex-col gap-3 border-t border-(--shop-ink)/8 pt-5 text-sm">
                <Row label="Subtotal">
                  {formatMoney(totals.subtotal, cart.currency)}
                </Row>

                {totals.discount > 0 && (
                  <Row label="Discount" accent>
                    <span className="flex items-center gap-1.5">
                      <Tag className="size-3.5" aria-hidden />−
                      {formatMoney(totals.discount, cart.currency)}
                    </span>
                  </Row>
                )}

                {/* Its own row rather than folded into "Discount", because the
                    two are earned differently — one is a code the shopper
                    found, this one is a choice they can still change from the
                    control a few centimetres to the left. Naming the method in
                    the label is what makes that connection. */}
                {totals.prepaidDiscount > 0 && (
                  <Row label="Prepaid discount (5%)" accent>
                    <span className="flex items-center gap-1.5">
                      −{formatMoney(totals.prepaidDiscount, cart.currency)}
                    </span>
                  </Row>
                )}

                <Row label="Shipping">
                  {totals.freeShipping ? (
                    <span className="text-(--shop-success)">Free</span>
                  ) : (
                    formatMoney(totals.shipping, cart.currency)
                  )}
                </Row>

                {totals.tax > 0 && (
                  <Row label="Tax">{formatMoney(totals.tax, cart.currency)}</Row>
                )}

                {/* Last before the total, and not tinted as a warning. It is a
                    charge, and a charge the shopper opted into — colouring it
                    red would be scolding them for a choice the store offered. */}
                {totals.codFee > 0 && (
                  <Row label="Cash on delivery fee">
                    +{formatMoney(totals.codFee, cart.currency)}
                  </Row>
                )}
              </dl>

              {/* The nudge, at the moment of maximum leverage: directly under
                  the fee it would remove, above the total it would lower. It
                  says nothing the payment cards do not, but it says it where
                  the shopper is looking at the number they dislike. */}
              {totals.codFee > 0 && prepaidSaving > 0 && (
                <p className="mt-3 text-xs text-(--shop-success)">
                  Pay online instead and save{" "}
                  {formatMoney(prepaidSaving + totals.codFee, cart.currency)} on
                  this order.
                </p>
              )}

              <div className="mt-5 flex items-baseline justify-between border-t border-(--shop-ink)/10 pt-5">
                <span className="font-medium">Total</span>
                <span className="display text-2xl tracking-[-0.02em] tabular-nums">
                  {formatMoney(totals.total, cart.currency)}
                </span>
              </div>

              {/* Nothing picked yet, so this total is real but not final — it
                  is the bag before the payment section moves it either way.
                  Saying so is the honest half; putting both figures in one
                  sentence is the persuasive half, and a shopper who reads
                  "−₹64.95" against "+₹49" has been given the comparison rather
                  than a slogan about it. */}
              {!methodChosen && (
                <p className="mt-3 text-xs text-(--shop-mute)">
                  Before payment.{" "}
                  <span className="text-(--shop-success)">
                    Pay online to take{" "}
                    {formatMoney(prepaidSaving, cart.currency)} off
                  </span>
                  , or add {formatMoney(codFee, cart.currency)} for cash on
                  delivery.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/**
 * One line, editable in place.
 *
 * Checkout used to be the one screen where the bag was frozen: a shopper who
 * spotted the wrong size here had to go back to the cart, change it, and walk
 * the form again — or abandon. Both controls write through to the same cart the
 * order is placed from, so what is shown and what is bought cannot diverge.
 *
 * Every control is `type="button"` or a bare `select` with no `name`. This
 * subtree lives *inside* the checkout `<form>`, so anything that submits or
 * carries a name would either place the order or ride along in the payload.
 */
function SummaryLine({
  line,
  currency,
  busy,
  onQuantity,
  onVariant,
  onRemove,
}: {
  line: CartLine;
  currency: string;
  busy: boolean;
  onQuantity: (quantity: number) => void;
  onVariant: (variantId: string) => void;
  onRemove: () => void;
}) {
  // A product with one variant has nothing to choose between, and a select
  // holding a single option is a control that looks interactive and is not.
  const sizes = line.options.length > 1 ? line.options : [];

  // Stock-aware, so the menu cannot offer a quantity the order would then be
  // rejected for. Ten is a sane ceiling for a summary picker regardless. The
  // lower bound is the line's own quantity, so a line already above the ceiling
  // can still show — and reduce — its current value.
  const quantityChoices = Math.max(
    Math.min(line.maxQuantity ?? QUANTITY_CHOICES, QUANTITY_CHOICES),
    line.quantity
  );

  return (
    <li className={cn("flex items-start gap-3", !line.available && "opacity-60")}>
      <div className="relative aspect-[4/5] w-14 shrink-0 overflow-hidden bg-(--shop-cloud)">
        {line.image ? (
          <Image src={line.image} alt="" fill sizes="56px" className="object-cover" />
        ) : (
          <span className="meta absolute inset-0 flex items-center justify-center text-(--shop-stone)">
            —
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-sm">{line.title}</p>
          <p className="shrink-0 text-sm tabular-nums">
            {formatMoney(line.lineTotal, currency)}
          </p>
        </div>

        {!line.available && (
          <p className="mt-1 text-xs text-(--shop-sale)">
            Sold out — remove to check out
          </p>
        )}
        {line.reduced && (
          <p className="mt-1 text-xs text-(--shop-sale)">
            Only {line.maxQuantity} left — quantity reduced
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {sizes.length > 0 ? (
            <VariantPopover line={line} disabled={busy} onChange={onVariant} />
          ) : (
            line.variantTitle && (
              <span className="text-xs text-(--shop-mute)">
                {shortVariantTitle(line.variantTitle)}
              </span>
            )
          )}

          <QuantityPopover
            line={line}
            disabled={busy || !line.available}
            max={quantityChoices}
            onChange={onQuantity}
          />

          <RemoveButton line={line} disabled={busy} onRemove={onRemove} />
        </div>
      </div>
    </li>
  );
}

/**
 * Remove, as an icon that asks before it acts.
 *
 * Removing takes the whole line, not one unit — so on a line of three it
 * discards all three, and there is no undo anywhere in checkout. That is the
 * test for a confirmation step: not how big the button is, but whether a
 * mis-tap is recoverable. Here it is not, and on a phone this control sits a
 * thumb's width from the size and quantity chips.
 *
 * The confirm is a popover rather than a modal dialog: it belongs to this line,
 * so it should be anchored to it rather than blanking the page and making the
 * shopper re-find where they were.
 */
function RemoveButton({
  line,
  disabled,
  onRemove,
}: {
  line: CartLine;
  disabled: boolean;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label={`Remove ${line.title}`}
        className={cn(
          "ml-auto inline-flex size-8 items-center justify-center rounded-full text-(--shop-mute)",
          "transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
          disabled
            ? "opacity-40"
            : "cursor-pointer hover:bg-(--shop-cloud) hover:text-(--shop-sale)"
        )}
      >
        <Trash2 className="size-4" aria-hidden />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        className="shop-scope w-auto max-w-64 gap-2 rounded-2xl p-3"
      >
        <p className="text-xs text-(--shop-ink)">
          Remove{" "}
          <span className="font-medium">
            {line.title}
            {line.variantTitle ? ` (${shortVariantTitle(line.variantTitle)})` : ""}
          </span>
          {line.quantity > 1 ? ` — all ${line.quantity} of them?` : " from your bag?"}
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-9 flex-1 cursor-pointer rounded-full border border-(--shop-hairline) bg-(--shop-canvas) text-xs text-(--shop-ink) transition-colors duration-150 hover:border-(--shop-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)"
          >
            Keep
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
            className="min-h-9 flex-1 cursor-pointer rounded-full bg-(--shop-sale) text-xs font-medium text-(--shop-canvas) transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-sale)"
          >
            Remove
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Switching variant, one axis at a time.
 *
 * A `select` listed every combination, which for two colours and six sizes is
 * twelve rows of "black-1 / l-1" — a shopper reading that has to parse the
 * cartesian product in their head to find the row they want. Splitting it back
 * into the axes the product actually declares turns twelve rows into two short
 * lines of chips, and it is the same model the product page already uses, so
 * changing size at checkout looks like changing it where they first chose it.
 *
 * A popover rather than a `select` because a native dropdown cannot be animated
 * or laid out in two dimensions. The cost is the platform picker on mobile; the
 * chips are 44px touch targets to earn that back.
 */
function VariantPopover({
  line,
  disabled,
  onChange,
}: {
  line: CartLine;
  disabled: boolean;
  onChange: (variantId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const current = line.options.find((option) => option.id === line.variantId);

  /* The selection being *composed*, which is not yet the selection in the bag.
     With two axes, committing on the first tap would send the shopper through
     an intermediate variant they never asked for — pick a colour and the order
     silently becomes white/L on the way to white/M, with a server round trip
     and a re-priced total for a combination that was only ever a waypoint. So
     taps move this draft, and one explicit action commits it. */
  const [draft, setDraft] = useState<string[]>(current?.values ?? []);

  // One axis per declared option, each holding its distinct values in the
  // store's own order (S, M, L — never alphabetical).
  const axes = line.optionNames.map((name, index) => ({
    name,
    values: sortOptionValues(name, [
      ...new Set(line.options.map((option) => option.values[index]).filter(Boolean)),
    ]),
  }));

  /* One axis is not a composition — there is nothing to pair it with, so
     staging it behind a confirm button would be a second tap for no decision. */
  const staged = axes.length > 1;

  const variantFrom = (values: string[]) =>
    line.options.find((option) => option.values.every((v, i) => v === values[i])) ??
    null;

  const withValue = (axisIndex: number, value: string) => {
    const next = [...draft];
    next[axisIndex] = value;
    return next;
  };

  const drafted = variantFrom(draft);
  const changed = Boolean(drafted && drafted.id !== line.variantId);

  function commit(variantId: string) {
    onChange(variantId);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Reopening always starts from what is actually in the bag, so an
        // abandoned edit cannot linger as a half-made choice.
        if (next) setDraft(current?.values ?? []);
        setOpen(next);
      }}
    >
      <PopoverTrigger
        type="button"
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-(--shop-hairline) px-2.5 py-1 text-xs text-(--shop-ink)",
          "transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
          disabled ? "opacity-40" : "cursor-pointer hover:border-(--shop-ink)"
        )}
      >
        {shortVariantTitle(current?.title ?? line.variantTitle)}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3 text-(--shop-mute) transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </PopoverTrigger>

      {/* `w-auto` overrides the primitive's fixed 18rem — this panel is as wide
          as its chips, which in a 23rem column matters. The enter/exit
          animation comes from the shared PopoverContent: a fade and a 95% scale
          from the trigger's own corner, ~100ms, transform and opacity only. */}
      <PopoverContent
        align="start"
        sideOffset={6}
        className="shop-scope w-auto max-w-60 gap-3 rounded-2xl p-3"
      >
        {axes.map((axis, axisIndex) => (
          <div key={axis.name}>
            <p className="meta mb-1.5 text-[10px] text-(--shop-mute)">{axis.name}</p>
            <div className="flex flex-wrap gap-1.5">
              {axis.values.map((value) => {
                const target = variantFrom(withValue(axisIndex, value));
                const active = draft[axisIndex] === value;
                const selectable = Boolean(target?.available);

                return (
                  <button
                    key={value}
                    type="button"
                    disabled={!selectable && !active}
                    aria-pressed={active}
                    onClick={() => {
                      const next = withValue(axisIndex, value);
                      setDraft(next);

                      if (!staged) {
                        const single = variantFrom(next);
                        if (single && single.id !== line.variantId) commit(single.id);
                      }
                    }}
                    className={cn(
                      // Every chip keeps a border, so "selected" is never
                      // signalled by the *absence* of something — it reads as
                      // more ink, not less. Fill plus weight plus a ring, so
                      // it survives greyscale and a quick glance alike.
                      "min-h-9 min-w-9 rounded-full border px-3 text-xs transition-colors duration-150",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
                      active
                        ? "border-(--shop-ink) bg-(--shop-ink) font-semibold text-(--shop-canvas) ring-1 ring-(--shop-ink) ring-offset-2 ring-offset-(--shop-canvas)"
                        : selectable
                          ? "cursor-pointer border-(--shop-hairline) bg-(--shop-canvas) text-(--shop-ink) hover:border-(--shop-ink)"
                          : // Struck through, not just faded: unavailability
                            // should not rest on contrast alone.
                            "cursor-not-allowed border-(--shop-hairline-soft) text-(--shop-stone) line-through"
                    )}
                  >
                    {shortSizeLabel(axis.name, value)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {staged && (
          <button
            type="button"
            disabled={!changed}
            onClick={() => drafted && commit(drafted.id)}
            className={cn(
              "mt-0.5 min-h-9 w-full rounded-full text-xs font-medium transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
              changed
                ? "cursor-pointer bg-(--shop-ink) text-(--shop-canvas)"
                : "cursor-not-allowed bg-(--shop-cloud) text-(--shop-stone)"
            )}
          >
            {/* Names the destination rather than saying "Update", so the button
                is also the confirmation of what was composed above. */}
            {changed && drafted
              ? `Change to ${shortVariantTitle(drafted.title)}`
              : "Pick a different option"}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Quantity, in the same chip language as the variant picker.
 *
 * Was a native `<select>`, which on Windows renders as a tall grey-highlighted
 * list that looked nothing like the rest of the summary. One axis, so a tap
 * commits — there is nothing to compose.
 */
function QuantityPopover({
  line,
  disabled,
  max,
  onChange,
}: {
  line: CartLine;
  disabled: boolean;
  max: number;
  onChange: (quantity: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const choices = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label={`Quantity for ${line.title}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-(--shop-hairline) px-2.5 py-1 text-xs text-(--shop-ink)",
          "transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
          disabled ? "opacity-40" : "cursor-pointer hover:border-(--shop-ink)"
        )}
      >
        Qty {line.quantity}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3 text-(--shop-mute) transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="shop-scope w-auto max-w-56 gap-0 rounded-2xl p-2"
      >
        <div className="grid grid-cols-5 gap-1.5">
          {choices.map((n) => {
            const active = n === line.quantity;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (!active) onChange(n);
                  setOpen(false);
                }}
                className={cn(
                  "min-h-9 min-w-9 rounded-full border text-xs tabular-nums transition-colors duration-150",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
                  active
                    ? "border-(--shop-ink) bg-(--shop-ink) font-semibold text-(--shop-canvas) ring-1 ring-(--shop-ink) ring-offset-2 ring-offset-(--shop-canvas)"
                    : "cursor-pointer border-(--shop-hairline) bg-(--shop-canvas) text-(--shop-ink) hover:border-(--shop-ink)"
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-(--shop-mute)">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          accent ? "text-(--shop-success)" : "text-(--shop-ink)"
        )}
      >
        {children}
      </dd>
    </div>
  );
}
