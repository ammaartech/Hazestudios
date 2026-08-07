"use client";

import { cn } from "@/lib/utils";

/**
 * Form primitives for checkout.
 *
 * Visually identical to the account forms' `Field`, but with the two things
 * checkout has to get right and sign-in does not: an error can be bound to a
 * specific control, and every label is persistent. Placeholder-as-label fails
 * the moment someone starts typing, which on an address form is the moment
 * they most need to know which line they are on.
 */

const CONTROL =
  "glass glass-on-light mt-2 h-12 w-full rounded-2xl px-4 text-[15px] text-(--shop-ink) outline-none transition-shadow duration-300 placeholder:text-(--shop-stone) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)";

const INVALID = "outline-2 outline-offset-2 outline-(--shop-sale)";

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  defaultValue,
  hint,
  invalid,
  className,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
  invalid?: boolean;
  className?: string;
}) {
  const hintId = hint ? `${name}-hint` : undefined;

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
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={hintId}
        className={cn(CONTROL, invalid && INVALID)}
      />
      {hint && (
        <span id={hintId} className="mt-1.5 block text-xs text-(--shop-mute)">
          {hint}
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
  required,
  invalid,
  className,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  required?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="meta text-(--shop-mute)">{label}</span>
      <select
        id={name}
        name={name}
        required={required}
        defaultValue={defaultValue}
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
}: {
  label: string;
  name: string;
  options: readonly {
    value: string;
    label: string;
    description?: string;
    available?: boolean;
    unavailableReason?: string | null;
  }[];
  defaultValue?: string;
}) {
  return (
    // `id` and a negative tabIndex so the form's error effect can find and focus
    // this the same way it focuses a text input — it looks the field up by
    // getElementById(name), and a group whose controls each carry the same name
    // has nowhere else to put it. Not in the tab order; the radios still are.
    <fieldset id={name} tabIndex={-1} className="block outline-none">
      <legend className="meta text-(--shop-mute)">{label}</legend>

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
                defaultChecked={option.value === defaultValue}
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
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-xs text-(--shop-mute)">
                    {option.description}
                  </span>
                )}
              </span>
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
