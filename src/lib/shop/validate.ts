/**
 * Checkout field rules, shared by the browser and the server action.
 *
 * One definition, two callers, on purpose. The form uses these to show a shopper
 * a tick the moment a field is right; `placeOrder` uses the same functions to
 * decide whether to accept the submission. If they were written twice they would
 * eventually disagree, and the failure mode of that is the worst one available:
 * a form that says the number is fine and a server that rejects it.
 *
 * Every function returns the problem as a sentence, or `null` when the value is
 * acceptable — so `null` reads as "nothing wrong with this".
 */

import { nationalPart } from "./phone-codes";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function emailProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter an email address.";
  return EMAIL.test(trimmed) ? null : "Enter a valid email address.";
}

/**
 * Indian mobile numbers are exactly ten digits and begin 6–9; landlines and the
 * rest of the world are not that shape, so the strict rule only applies to `IN`.
 * Everywhere else takes a permissive 7–15 digits, which is the E.164 range.
 *
 * A leading `91`/`+91` is tolerated and ignored — shoppers type it about half
 * the time, and rejecting a correct number over a country code the field did
 * not ask for is the kind of thing that loses a sale.
 */
export function phoneProblem(value: string, country: string): string | null {
  const raw = value.trim();
  if (!raw) return "Enter a phone number.";

  // Through `nationalPart` rather than a local strip, so this and `formatPhone`
  // can never disagree about where the country code ends — see that function.
  const digits = nationalPart(raw, country);

  if (country === "IN") {
    if (digits.length !== 10) return "Enter a 10-digit mobile number.";
    if (!/^[6-9]/.test(digits)) return "Indian mobile numbers start with 6, 7, 8 or 9.";
    return null;
  }

  if (digits.length < 7 || digits.length > 15) {
    return "Enter a valid phone number.";
  }
  return null;
}

/**
 * Indian PIN codes are six digits and never start with zero. Other countries
 * have wildly different formats (and the UK's are not even all digits), so
 * anything non-`IN` is only checked for being present and plausible.
 */
export function postalCodeProblem(value: string, country: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter a postal code.";

  if (country === "IN") {
    if (!/^[1-9]\d{5}$/.test(trimmed)) return "Enter a 6-digit PIN code.";
    return null;
  }

  return trimmed.length >= 3 ? null : "Enter a valid postal code.";
}

/** True when the value is a PIN code worth spending a lookup on. */
export function isLookupablePin(value: string, country: string): boolean {
  return country === "IN" && /^[1-9]\d{5}$/.test(value.trim());
}

/** The rule behind every "this field cannot be blank" message on the form. */
export function requiredProblem(value: string, message: string): string | null {
  return value.trim() ? null : message;
}
