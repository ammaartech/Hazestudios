"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { dialCodeFor, flagEmoji, sanitizePhoneInput } from "@/lib/shop/phone-codes";
import type { SavedAddress } from "@/lib/shop/checkout-totals";
import { cn } from "@/lib/utils";

/**
 * Form primitives for checkout.
 *
 * Visually identical to the account forms' `Field`, but with the three things
 * checkout has to get right and sign-in does not: an error can be bound to a
 * specific control, every label is persistent, and a field that is *right* says
 * so. Placeholder-as-label fails the moment someone starts typing, which on an
 * address form is the moment they most need to know which line they are on.
 *
 * On confirming correctness rather than only flagging errors: an address form
 * is long, and the shopper filling one has no idea whether they are doing it
 * properly until they hit submit and find out all at once. A tick per field
 * turns that into a running answer. It appears only once a field is both
 * non-empty and valid, so it reads as progress rather than decoration.
 */

const CONTROL =
  "glass glass-on-light mt-2 h-12 w-full rounded-2xl px-4 text-[15px] text-(--shop-ink) outline-none transition-shadow duration-300 placeholder:text-(--shop-stone) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)";

const INVALID = "outline-2 outline-offset-2 outline-(--shop-sale)";

/**
 * A single field's live state.
 *
 * `validate` returns a sentence or `null` — see `src/lib/shop/validate.ts`.
 * The rule about *when* to show each result is the interesting part:
 *
 *   - The tick shows as soon as the value is valid, mid-typing included. It is
 *     good news, and good news early is the whole point.
 *   - The error waits for blur. Telling someone their phone number is too short
 *     while they are still typing it is technically true and actively hostile.
 */
function useFieldState(value: string, validate?: (value: string) => string | null) {
  const [blurred, setBlurred] = useState(false);

  const problem = validate ? validate(value) : null;
  const filled = value.trim() !== "";

  return {
    onBlur: () => setBlurred(true),
    // Re-typing after an error clears the error until they leave the field
    // again, so the message does not sit there contradicting a fix in progress.
    onChange: () => setBlurred(false),
    showValid: filled && !problem,
    problem: blurred && filled ? problem : null,
  };
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  defaultValue,
  value,
  onChange,
  validate,
  hint,
  invalid,
  inputMode,
  maxLength,
  busy,
  className,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  /** Supply with `onChange` to drive the field from the parent. */
  value?: string;
  onChange?: (value: string) => void;
  /** Returns the problem with the current value, or `null` when it is fine. */
  validate?: (value: string) => string | null;
  hint?: string;
  /** Set by the server action's reply, to mark the field it rejected. */
  invalid?: boolean;
  inputMode?: "text" | "numeric" | "tel" | "email";
  maxLength?: number;
  /** Shows a spinner in place of the tick — a lookup is in flight. */
  busy?: boolean;
  className?: string;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = controlled ? value : inner;

  const field = useFieldState(current, validate);
  const messageId = useId();

  const message = field.problem ?? hint;
  const showProblem = Boolean(field.problem);
  const flagged = invalid || showProblem;

  return (
    <label className={cn("block", className)}>
      <span className="meta text-(--shop-mute)">
        {label}
        {!required && (
          <span className="ml-1.5 normal-case text-(--shop-stone)">
            (optional)
          </span>
        )}
      </span>

      {/* Relative so the status glyph can sit inside the control's trailing
          edge rather than reflowing the row when it appears. */}
      <span className="relative block">
        <input
          id={name}
          name={name}
          type={type}
          required={required}
          value={current}
          inputMode={inputMode}
          maxLength={maxLength}
          onChange={(event) => {
            const next = event.currentTarget.value;
            field.onChange();
            if (controlled) onChange?.(next);
            else setInner(next);
          }}
          onBlur={field.onBlur}
          autoComplete={autoComplete}
          aria-invalid={flagged || undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(
            CONTROL,
            flagged && INVALID,
            (field.showValid || busy) && "pr-11"
          )}
        />

        {busy ? (
          <Loader2
            className="pointer-events-none absolute top-1/2 right-4 size-4 translate-y-[calc(-50%+0.25rem)] animate-spin text-(--shop-mute)"
            aria-hidden
          />
        ) : (
          field.showValid && (
            <Check
              className="pointer-events-none absolute top-1/2 right-4 size-4 translate-y-[calc(-50%+0.25rem)] text-(--shop-success)"
              strokeWidth={2.5}
              aria-hidden
            />
          )
        )}
      </span>

      {message && (
        <span
          id={messageId}
          // Announced when it becomes a problem, silent when it is only a hint —
          // a screen reader should not read the whole form's help text aloud on
          // every keystroke.
          role={showProblem ? "alert" : undefined}
          className={cn(
            "mt-1.5 block text-xs",
            showProblem ? "text-(--shop-sale)" : "text-(--shop-mute)"
          )}
        >
          {message}
        </span>
      )}
    </label>
  );
}

export function SelectField({
  label,
  name,
  options,
  defaultValue,
  value,
  onChange,
  required,
  invalid,
  className,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  /** Supply with `onChange` to drive the select from the parent. */
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const controlled = value !== undefined;

  return (
    <label className={cn("block", className)}>
      <span className="meta text-(--shop-mute)">{label}</span>
      <select
        id={name}
        name={name}
        required={required}
        {...(controlled
          ? { value, onChange: (e) => onChange?.(e.currentTarget.value) }
          : { defaultValue })}
        aria-invalid={invalid || undefined}
        // `appearance-none` plus the caret below, because the native control
        // renders in the OS palette and would be the one element on the page
        // ignoring the theme.
        className={cn(
          CONTROL,
          "cursor-pointer appearance-none bg-[length:0.7rem] bg-[right_1rem_center] bg-no-repeat pr-10",
          invalid && INVALID
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none' stroke='%23707072' stroke-width='1.5'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E\")",
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A phone number and the country it dials from.
 *
 * One control, two inputs: a `select` carrying the ISO country code and a `tel`
 * input carrying the national number. They submit separately (`phone_country`
 * and `phone`) and `placeOrder` joins them, so the stored number is unambiguous
 * without this component having to know the storage format.
 *
 * The select's value is the *country*, not the dialling code, because dialling
 * codes are not unique — `+1` is both the US and Canada, and a value that
 * cannot tell them apart is one that cannot be defaulted correctly either.
 */
export function PhoneField({
  label,
  name,
  countryName,
  countryValue,
  onCountryChange,
  countries,
  defaultValue,
  required,
  validate,
  hint,
  invalid,
}: {
  label: string;
  name: string;
  /** Field name for the country select. */
  countryName: string;
  countryValue: string;
  onCountryChange: (country: string) => void;
  countries: { code: string; name: string }[];
  defaultValue?: string;
  required?: boolean;
  validate?: (value: string) => string | null;
  hint?: string;
  invalid?: boolean;
}) {
  // Sanitised on the way in too: a returning shopper's stored number carries
  // its dialling code (`+91 9876543210`), and that code belongs in the select
  // beside this input, not inside it.
  const [number, setNumber] = useState(() =>
    sanitizePhoneInput(defaultValue ?? "", countryValue)
  );
  const field = useFieldState(number, validate);
  const messageId = useId();

  const message = field.problem ?? hint;
  const showProblem = Boolean(field.problem);
  const flagged = invalid || showProblem;

  const dial = dialCodeFor(countryValue);

  return (
    <div className="block">
      {/* A `label` element would have to point at one of the two controls, and
          pointing it at the number input makes clicking the text jump past the
          country select. A group label is the honest markup. */}
      <span id={`${name}-label`} className="meta text-(--shop-mute)">
        {label}
        {!required && (
          <span className="ml-1.5 normal-case text-(--shop-stone)">(optional)</span>
        )}
      </span>

      {/* The two controls share one glass shell so they read as a single field.
          The ring is driven by `has-focus-visible` on the wrapper, so focusing
          either half lights the whole control rather than half of it. */}
      <div
        className={cn(
          "glass glass-on-light mt-2 flex h-12 w-full items-stretch overflow-hidden rounded-2xl transition-shadow duration-300",
          "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--shop-ink)",
          flagged && INVALID
        )}
      >
        {/* The collapsed control is drawn by the span below and the real
            `select` sits invisibly on top of it.

            A `select` renders its chosen option's full text and nothing else,
            so showing "🇮🇳 India +91" in the list forced the same string into a
            120px control, where it truncated to "🇮🇳 +91 In…". Painting the
            closed state separately lets the list stay descriptive — full
            country names, which is what makes it scannable — while the control
            shows only the flag and the code, which is all it needs to.

            The select keeps every native behaviour: click, keyboard, type-ahead,
            and the platform picker on mobile. It is transparent, not hidden, so
            it is still focusable and still announced. */}
        <span className="relative flex shrink-0 items-center">
          <span
            aria-hidden
            className="pointer-events-none flex items-center gap-1.5 pr-3 pl-4 text-[15px] text-(--shop-ink)"
          >
            <span className="flag-text leading-none">{flagEmoji(countryValue)}</span>
            <span className="tabular-nums">{dial}</span>
            <ChevronDown className="size-3 text-(--shop-mute)" strokeWidth={2} />
          </span>

          <select
            id={countryName}
            name={countryName}
            value={countryValue}
            onChange={(event) => onCountryChange(event.currentTarget.value)}
            aria-label="Country calling code"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          >
            {countries.map((country) => {
              const code = dialCodeFor(country.code);
              if (!code) return null;
              return (
                // `flag-text` here too: the dropdown is rendered by the browser
                // from these elements, so the font has to be on them to reach it.
                <option key={country.code} value={country.code} className="flag-text">
                  {flagEmoji(country.code)} {code} {country.name}
                </option>
              );
            })}
          </select>
        </span>

        {/* Hairline between the halves, so the shell does not read as one very
            wide text box with a stray flag in it. */}
        <span aria-hidden className="my-2 w-px shrink-0 bg-(--shop-hairline)" />

        <span className="relative flex min-w-0 flex-1 items-center">
          <input
            id={name}
            name={name}
            type="tel"
            inputMode="tel"
            required={required}
            value={number}
            onChange={(event) => {
              field.onChange();
              // Digits only, country code stripped, capped at the national
              // length — so the field cannot hold something the shopper can
              // see is wrong but not why. See `sanitizePhoneInput`.
              setNumber(sanitizePhoneInput(event.currentTarget.value, countryValue));
            }}
            onBlur={field.onBlur}
            autoComplete="tel-national"
            aria-labelledby={`${name}-label`}
            aria-invalid={flagged || undefined}
            aria-describedby={message ? messageId : undefined}
            placeholder={dial === "+91" ? "98765 43210" : undefined}
            className={cn(
              "h-full w-full bg-transparent px-4 text-[15px] text-(--shop-ink) outline-none placeholder:text-(--shop-stone)",
              field.showValid && "pr-11"
            )}
          />
          {field.showValid && (
            <Check
              className="pointer-events-none absolute right-4 size-4 text-(--shop-success)"
              strokeWidth={2.5}
              aria-hidden
            />
          )}
        </span>
      </div>

      {message && (
        <span
          id={messageId}
          role={showProblem ? "alert" : undefined}
          className={cn(
            "mt-1.5 block text-xs",
            showProblem ? "text-(--shop-sale)" : "text-(--shop-mute)"
          )}
        >
          {message}
        </span>
      )}
    </div>
  );
}

/**
 * Saved addresses, as cards to pick between.
 *
 * The point of the address book is that a returning shopper should be choosing,
 * not typing — so the saved ones come first and the form below is what "Use a
 * different address" opens onto, rather than the other way round.
 *
 * Radios rather than buttons: this is one question with several answers, and
 * the native control already gives arrow-key movement within the group and
 * announces "2 of 3" without being told to.
 */
export function AddressBook({
  addresses,
  selectedId,
  onSelect,
}: {
  addresses: SavedAddress[];
  /** The chosen address, or `null` for "a different address". */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <fieldset className="block">
      <legend className="meta text-(--shop-mute)">Deliver to</legend>

      <div className="mt-2 flex flex-col gap-2">
        {addresses.map((address) => {
          const active = address.id === selectedId;

          return (
            <label
              key={address.id}
              className={cn(
                "glass glass-on-light flex cursor-pointer items-start gap-3 rounded-2xl px-4 py-3 transition-shadow duration-300",
                "has-checked:outline-2 has-checked:outline-offset-2 has-checked:outline-(--shop-ink)",
                "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--shop-ink)"
              )}
            >
              <input
                type="radio"
                name="saved_address"
                value={address.id}
                checked={active}
                onChange={() => onSelect(address.id)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-(--shop-ink) outline-none"
              />

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-(--shop-ink)">
                    {address.label}
                  </span>
                  {address.isDefault && (
                    <span className="meta rounded-full bg-(--shop-ink)/8 px-2 py-0.5 text-[10px] text-(--shop-mute)">
                      Default
                    </span>
                  )}
                </span>

                {/* One line, in the order an envelope is read. */}
                <span className="mt-0.5 block text-xs leading-relaxed text-(--shop-mute)">
                  {[
                    [address.first_name, address.last_name]
                      .filter(Boolean)
                      .join(" "),
                    address.address1,
                    address.address2,
                    address.city,
                    address.province,
                    address.postal_code,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  {address.phone && ` · ${address.phone}`}
                </span>
              </span>
            </label>
          );
        })}

        <label
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-(--shop-hairline) px-4 py-3 transition-colors duration-200",
            "hover:border-(--shop-ink) has-checked:border-solid has-checked:border-(--shop-ink)",
            "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--shop-ink)"
          )}
        >
          <input
            type="radio"
            name="saved_address"
            value=""
            checked={selectedId === null}
            onChange={() => onSelect(null)}
            className="size-4 shrink-0 cursor-pointer accent-(--shop-ink) outline-none"
          />
          <span className="flex items-center gap-2 text-sm text-(--shop-ink)">
            <Plus className="size-4 text-(--shop-mute)" aria-hidden />
            Deliver somewhere else
          </span>
        </label>
      </div>
    </fieldset>
  );
}

/**
 * What to call an address being saved for the first time.
 *
 * Three suggestions and a free-text field, rather than a fixed enum: "Home" and
 * "Work" cover most of it, and the moment someone wants "Mum's place" an enum
 * is a migration. Pre-filled with Home so the common case is already answered.
 */
export function AddressLabelField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const suggestions = ["Home", "Work", "Other"];

  return (
    <div className="block">
      <span className="meta text-(--shop-mute)">Save this address as</span>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {suggestions.map((suggestion) => {
          const active = value.trim().toLowerCase() === suggestion.toLowerCase();
          return (
            <button
              key={suggestion}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(suggestion)}
              className={cn(
                "min-h-9 cursor-pointer rounded-full border px-4 text-xs transition-colors duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)",
                active
                  ? "border-(--shop-ink) bg-(--shop-ink) font-semibold text-(--shop-canvas)"
                  : "border-(--shop-hairline) bg-(--shop-canvas) text-(--shop-ink) hover:border-(--shop-ink)"
              )}
            >
              {suggestion}
            </button>
          );
        })}

        <input
          name="address_label"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          maxLength={24}
          aria-label="Address label"
          placeholder="Or type a name"
          className="glass glass-on-light h-9 min-w-0 flex-1 rounded-full px-4 text-xs text-(--shop-ink) outline-none placeholder:text-(--shop-stone) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)"
        />
      </div>
    </div>
  );
}

/** A titled block of the form. Three of these are the whole checkout. */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="display text-xl tracking-[-0.02em]">{title}</h2>
      {description && (
        <p className="mt-1.5 text-sm text-(--shop-mute)">{description}</p>
      )}
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * A group of mutually exclusive options, rendered as cards.
 *
 * A real `fieldset`/`legend` wrapping real radios, so the group announces as one
 * question and arrow keys move within it. Nothing here re-implements that: the
 * native control already skips disabled options and wraps at the ends, and
 * every hand-rolled version of this behaviour gets one of those wrong.
 *
 * Unavailable options render disabled with the reason visible rather than being
 * dropped from the list. Hiding a method a store intends to offer tells the
 * shopper it will never exist; greying it out tells them to come back.
 */
export function RadioField({
  label,
  name,
  options,
  defaultValue,
  value,
  onChange,
  hint,
}: {
  label: string;
  name: string;
  options: readonly {
    value: string;
    label: string;
    description?: string;
    available?: boolean;
    unavailableReason?: string | null;
    /** A short flag beside the label — "Save 5%". Shown on live options only. */
    badge?: string | null;
    /** What choosing this does to the total, already formatted. */
    priceNote?: string | null;
    /** Tints `priceNote` as a saving rather than a charge. */
    priceIsSaving?: boolean;
  }[];
  defaultValue?: string;
  /** Supply with `onChange` to drive the group from the parent. */
  value?: string;
  onChange?: (value: string) => void;
  /** A line under the legend. Used to say the group is still unanswered. */
  hint?: string;
}) {
  const controlled = value !== undefined;

  return (
    // `id` and a negative tabIndex so the form's error effect can find and focus
    // this the same way it focuses a text input — it looks the field up by
    // getElementById(name), and a group whose controls each carry the same name
    // has nowhere else to put it. Not in the tab order; the radios still are.
    <fieldset id={name} tabIndex={-1} className="block outline-none">
      <legend className="meta text-(--shop-mute)">{label}</legend>

      {/* Announced, because the commonest way to arrive here is the commit
          button sending the shopper back for this one answer — and a screen
          reader user who lands on a group with nothing checked should be told
          why they were moved rather than left to work it out. */}
      {hint && (
        <p role="status" className="mt-1.5 text-xs text-(--shop-mute)">
          {hint}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-3">
        {options.map((option) => {
          const disabled = option.available === false;

          return (
            <label
              key={option.value}
              className={cn(
                "glass glass-on-light flex items-start gap-3 rounded-2xl px-5 py-4 transition-shadow duration-300",
                // The ring follows the input's state rather than React's, so the
                // card is styled by the same event that moves the radio — no
                // client state, and no frame where the two disagree.
                "has-checked:outline-2 has-checked:outline-offset-2 has-checked:outline-(--shop-ink)",
                "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--shop-ink)",
                disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                {...(controlled
                  ? {
                      checked: option.value === value,
                      onChange: () => onChange?.(option.value),
                    }
                  : { defaultChecked: option.value === defaultValue })}
                disabled={disabled}
                className={cn(
                  "mt-0.5 size-5 shrink-0 accent-(--shop-ink)",
                  // The card owns the focus ring; a second one on the control
                  // inside it reads as two focused things.
                  "outline-none",
                  disabled ? "cursor-not-allowed" : "cursor-pointer"
                )}
              />

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-(--shop-ink)">
                  {option.label}
                  {disabled && option.unavailableReason && (
                    <span className="meta rounded-full bg-(--shop-ink)/8 px-2 py-0.5 text-[10px] text-(--shop-mute)">
                      {option.unavailableReason}
                    </span>
                  )}
                  {/* The incentive, stated where the choice is made. Solid
                      rather than tinted, because it is the one thing on this
                      card meant to be read before the label it sits beside. */}
                  {!disabled && option.badge && (
                    <span className="meta rounded-full bg-(--shop-success) px-2 py-0.5 text-[10px] text-(--shop-canvas)">
                      {option.badge}
                    </span>
                  )}
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-xs text-(--shop-mute)">
                    {option.description}
                  </span>
                )}
              </span>

              {/* The money, on the right where a shopper scanning two rows can
                  compare the two figures without reading either sentence. It is
                  the sum, not a decoration: `aria-hidden` is wrong here, so it
                  is announced as part of the label the radio belongs to. */}
              {option.priceNote && (
                <span
                  className={cn(
                    "shrink-0 self-center text-sm font-medium tabular-nums",
                    option.priceIsSaving
                      ? "text-(--shop-success)"
                      : "text-(--shop-mute)"
                  )}
                >
                  {option.priceNote}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A checkbox with its label. Bigger hit area than the native control gives, and
 * the whole row is the target — a 13px tick box is not a touch target.
 */
export function CheckboxField({
  name,
  label,
  hint,
  defaultChecked,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        onChange={(event) => onChange?.(event.currentTarget.checked)}
        className="mt-0.5 size-5 shrink-0 cursor-pointer rounded-md border border-(--shop-hairline) accent-(--shop-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)"
      />
      <span>
        <span className="text-sm text-(--shop-ink)">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-xs text-(--shop-mute)">{hint}</span>
        )}
      </span>
    </label>
  );
}
