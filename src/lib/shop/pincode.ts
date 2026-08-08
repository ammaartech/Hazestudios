/**
 * PIN code → city and state, from India Post.
 *
 * `api.postalpincode.in` is a free, keyless mirror of the Department of Posts'
 * PIN directory. No key means nothing to leak and no quota to blow through, and
 * the data is the authority for exactly the two fields a shopper most often
 * gets wrong: which district they are in and how their state is spelled. That
 * second one matters more than it looks — Qikink matches on a correctly spelled
 * state *name*, not a code (see `src/lib/qikink/map.ts`), so a shopper typing
 * "Karnatka" is an order their courier rejects.
 *
 * Cached hard because a PIN code's district does not change. The upstream is a
 * free service with no SLA, so the cache is also what keeps a slow afternoon
 * there from being a slow checkout here.
 */

import { cacheLife } from "next/cache";

export interface PincodeArea {
  city: string;
  province: string;
  /** Post office / locality names under this PIN, for the shopper to pick from. */
  localities: string[];
}

/** India Post's rows, narrowed to the three fields worth reading. */
interface PostOffice {
  Name?: string;
  District?: string;
  State?: string;
}

interface PostalResponse {
  Status?: string;
  PostOffice?: PostOffice[] | null;
}

/**
 * Bounded so a hung upstream cannot hold a shopper's field in a spinner. Four
 * seconds is generous for a lookup that usually answers in under one, and the
 * failure is soft: the fields simply stay manual.
 */
const TIMEOUT_MS = 4000;

export async function lookupPincode(pin: string): Promise<PincodeArea | null> {
  "use cache";
  cacheLife("days");

  if (!/^[1-9]\d{5}$/.test(pin)) return null;

  try {
    const response = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });

    if (!response.ok) return null;

    // Their envelope is a single-element array, and a PIN they do not recognise
    // is `Status: "Error"` with a null PostOffice rather than a 404.
    const body = (await response.json()) as PostalResponse[] | null;
    const record = Array.isArray(body) ? body[0] : null;
    if (!record || record.Status !== "Success") return null;

    const offices = record.PostOffice ?? [];
    const first = offices[0];
    if (!first?.District || !first.State) return null;

    // Every office under one PIN shares a district and state, so the first row
    // decides both. The names differ, and that list is the useful part.
    const localities = [
      ...new Set(offices.map((o) => o.Name?.trim()).filter((n): n is string => !!n)),
    ].sort((a, b) => a.localeCompare(b));

    return {
      city: first.District.trim(),
      province: first.State.trim(),
      localities,
    };
  } catch {
    // A timeout, a DNS failure, or HTML where JSON was promised. None of these
    // are the shopper's problem and none of them should stop a checkout — the
    // caller falls back to letting them type the fields themselves.
    return null;
  }
}
