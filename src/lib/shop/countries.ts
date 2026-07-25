/**
 * Shipping destinations.
 *
 * ISO 3166-1 alpha-2 codes only — names are derived through `Intl.DisplayNames`
 * so the list cannot drift out of step with the spelling a shopper expects, and
 * so translating the storefront later is a locale argument rather than a second
 * list to maintain.
 *
 * Curated rather than exhaustive: 249 codes in a select is a worse experience
 * than 90 covering the markets a store actually ships to. Adding one is one
 * line, which is the right cost — a real shipping-zones table (see
 * docs/SHOPIFY_GAP.md §2) will eventually decide this list from the operator's
 * own configuration.
 */

const COUNTRY_CODES = [
  // Anchored to the top because "which country" has one overwhelmingly likely
  // answer per store, and scrolling past Afghanistan to reach it is friction
  // paid by every single shopper.
  "US", "CA", "GB", "AU",

  "AE", "AR", "AT", "BE", "BG", "BH", "BR", "CH", "CL", "CN", "CO", "CY", "CZ",
  "DE", "DK", "EE", "EG", "ES", "FI", "FR", "GH", "GR", "HK", "HR", "HU", "ID",
  "IE", "IL", "IN", "IS", "IT", "JP", "KE", "KR", "KW", "LT", "LU", "LV", "MA",
  "MT", "MX", "MY", "NG", "NL", "NO", "NZ", "OM", "PA", "PE", "PH", "PK", "PL",
  "PT", "QA", "RO", "RS", "SA", "SE", "SG", "SI", "SK", "TH", "TR", "TW", "UA",
  "UY", "VN", "ZA",
] as const;

export interface Country {
  code: string;
  name: string;
}

/**
 * `Intl.DisplayNames` is available in every runtime this app targets, but a
 * missing ICU dataset would otherwise blank the whole select — so an
 * unresolvable code falls back to itself rather than disappearing.
 */
function nameFor(code: string, display: Intl.DisplayNames | null): string {
  try {
    return display?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function getCountries(locale = "en"): Country[] {
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    display = null;
  }

  const pinned = COUNTRY_CODES.slice(0, 4);
  const rest = COUNTRY_CODES.slice(4)
    .map((code) => ({ code, name: nameFor(code, display) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));

  return [
    ...pinned.map((code) => ({ code, name: nameFor(code, display) })),
    ...rest,
  ];
}

/** Renders a stored country code back to a name for the confirmation page. */
export function countryName(code: string, locale = "en"): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
