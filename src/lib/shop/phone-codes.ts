/**
 * International dialling codes for the countries this store ships to.
 *
 * A static table because there is no `Intl` API for dialling codes — names come
 * from `Intl.DisplayNames` in `countries.ts`, but E.164 country codes have to be
 * written down. Kept in step with `COUNTRY_CODES` there: a country in the
 * shipping list with no entry here falls back to no prefix rather than a wrong
 * one, which is the safe direction to fail.
 */

const DIAL_CODES: Record<string, string> = {
  IN: "91", US: "1", CA: "1", GB: "44", AU: "61",

  AE: "971", AR: "54", AT: "43", BE: "32", BG: "359", BH: "973", BR: "55",
  CH: "41", CL: "56", CN: "86", CO: "57", CY: "357", CZ: "420", DE: "49",
  DK: "45", EE: "372", EG: "20", ES: "34", FI: "358", FR: "33", GH: "233",
  GR: "30", HK: "852", HR: "385", HU: "36", ID: "62", IE: "353", IL: "972",
  IS: "354", IT: "39", JP: "81", KE: "254", KR: "82", KW: "965", LT: "370",
  LU: "352", LV: "371", MA: "212", MT: "356", MX: "52", MY: "60", NG: "234",
  NL: "31", NO: "47", NZ: "64", OM: "968", PA: "507", PE: "51", PH: "63",
  PK: "92", PL: "48", PT: "351", QA: "974", RO: "40", RS: "381", SA: "966",
  SE: "46", SG: "65", SI: "386", SK: "421", TH: "66", TR: "90", TW: "886",
  UA: "380", UY: "598", VN: "84", ZA: "27",
};

/** `"+91"` for India, or `""` for a country with no entry above. */
export function dialCodeFor(country: string): string {
  const code = DIAL_CODES[country.toUpperCase()];
  return code ? `+${code}` : "";
}

export function hasDialCode(country: string): boolean {
  return Boolean(DIAL_CODES[country.toUpperCase()]);
}

/**
 * The flag as a pair of regional indicator symbols, derived from the ISO code
 * rather than shipped as an asset — 70 SVGs to render one glyph each is a lot
 * of bytes on a checkout page.
 *
 * Worth knowing: Windows ships no flag glyphs, so Chrome and Firefox there
 * render the two letters ("IN") instead of a flag. That is why the dialling
 * code is always shown as text beside it — the control still reads correctly
 * when the flag does not draw, which it would not if the flag carried the
 * meaning on its own.
 */
export function flagEmoji(country: string): string {
  const code = country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65)
  );
}

/**
 * The digits a domestic courier expects, recovered from whatever was stored.
 *
 * `orders.phone` holds an international number (`+91 98765 43210`), but Qikink
 * is an Indian printer shipping domestically and its create-order call wants the
 * plain ten digits. This is deliberately forgiving about separators, because
 * historic orders — and anything typed before this field had a country selector
 * — hold whatever the shopper pasted.
 */
export function nationalPhoneDigits(phone: string): string {
  let digits = (phone ?? "").replace(/\D/g, "");

  // `91` + ten digits is an Indian number carrying its country code. No other
  // destination this store ships to produces a twelve-digit number starting 91.
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  // A trunk prefix, which shoppers type out of habit and no API wants.
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  return digits;
}

/**
 * The national number, with any country code the shopper typed anyway removed.
 *
 * People put `+91` into a field that already shows `+91` about half the time,
 * and the number is still correct when they do. This is the one place that
 * decides what counts as the national part, and both the validator and the
 * formatter go through it — when they disagreed, the result was a stored
 * `+91 919876543210`, which is a phone number no courier can ring.
 *
 * Stripping is deliberately cautious, because a wrong strip is worse than a
 * missed one. `9198765432` is a perfectly good Indian mobile that happens to
 * begin `91`, so a bare prefix match is not enough on its own:
 *
 *   - an explicit `+` (or `00`) means the shopper said "country code follows",
 *     and is trusted;
 *   - otherwise only a length that cannot be anything else is trusted — twelve
 *     digits beginning `91` for India.
 */
export function nationalPart(value: string, country: string): string {
  const raw = (value ?? "").trim();
  const iso = country.toUpperCase();
  const dial = DIAL_CODES[iso];

  let digits = raw.replace(/\D/g, "");
  if (!dial) return digits;

  const explicit = raw.startsWith("+") || raw.startsWith("00");
  if (explicit) {
    if (raw.startsWith("00")) digits = digits.replace(/^00/, "");
    if (digits.length > dial.length && digits.startsWith(dial)) {
      digits = digits.slice(dial.length);
    }
  } else if (digits.length === dial.length + 10 && digits.startsWith(dial)) {
    // Ten national digits behind a country code — India's shape, and unambiguous.
    digits = digits.slice(dial.length);
  }

  // A trunk prefix, typed out of habit and wanted by nothing.
  if (iso === "IN" && digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return digits;
}

/**
 * How many digits the national number may have. Indian mobiles are exactly ten;
 * elsewhere 15 is E.164's ceiling, which is a backstop rather than a real rule.
 */
export function maxNationalDigits(country: string): number {
  return country.toUpperCase() === "IN" ? 10 : 15;
}

/**
 * What the phone input is allowed to contain after each keystroke or paste.
 *
 * Two jobs, and the order matters. The country code is removed *first* and the
 * length capped *second*, so pasting `+917259941403` yields `7259941403` rather
 * than the first ten characters of it (`+91725994`, mangled beyond repair).
 * This is also why the input carries no `maxLength` attribute: the browser
 * enforces that against a paste before any handler runs, which would truncate
 * the country code onto the number and quietly produce a wrong phone.
 */
export function sanitizePhoneInput(value: string, country: string): string {
  return nationalPart(value, country).slice(0, maxNationalDigits(country));
}

/**
 * How a phone number is stored: dialling code, a space, then the national
 * number. The space is not decoration — it is what makes the country code
 * recoverable later without a lookup table, since dialling codes are not a
 * prefix-free set.
 */
export function formatPhone(national: string, country: string): string {
  const digits = nationalPart(national, country);
  if (!digits) return "";

  const dial = dialCodeFor(country);
  return dial ? `${dial} ${digits}` : digits;
}
