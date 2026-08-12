/**
 * The Summer Sands waitlist: the campaign's copy and its shared vocabulary.
 *
 * Everything the page, the form and the Server Action all need lives here so
 * they cannot drift — most importantly the craft ids, which are a `check`
 * constraint in 0024_waitlist.sql, a validation branch in the action, and a row
 * of chips in the form. Three places, one list.
 *
 * Deliberately free of server-only imports. The form is a Client Component and
 * pulls `CRAFTS` and `EVENT` from here, so anything in this file ships to the
 * browser: the cached seat count that used to live here reached for
 * `next/cache` and the service-role client, and broke the client build the
 * moment the chips imported it. It now sits in `src/app/waitlist/stats.ts`,
 * next to the server page that is its only caller.
 */

import type { WaitlistStatus } from "@/lib/types";
import { BRAND_INSTAGRAMS } from "./home-content";

/** How many people actually fit in the room. */
export const SEATS = 20;

/**
 * The four things you can make, in the order they appear on the page.
 *
 * `id` is what the database stores and the action validates. `label` is the
 * chip. `ticket` is the single word printed on the confirmation stub, kept
 * separate because "beaded keychain" does not fit in a 34px display face.
 */
export const CRAFTS = [
  { id: "fan", label: "silk fan", ticket: "fan" },
  { id: "lantern", label: "paper lantern", ticket: "lantern" },
  { id: "keychain", label: "beaded keychain", ticket: "keychain" },
  { id: "polaroid", label: "polaroid holder", ticket: "polaroid" },
] as const;

export type CraftId = (typeof CRAFTS)[number]["id"];

const CRAFT_IDS: readonly string[] = CRAFTS.map((c) => c.id);

export function isCraftId(value: string): value is CraftId {
  return CRAFT_IDS.includes(value);
}

export function craftTicketLabel(id: string): string {
  return CRAFTS.find((c) => c.id === id)?.ticket ?? CRAFTS[0].ticket;
}

/**
 * Where an entry is in the triage the admin does by hand, in the order the
 * filter tabs show them.
 *
 * Mirrors the `check` constraint in 0024_waitlist.sql. Kept beside `CRAFTS` for
 * the same reason: the database, the admin filter and the status control must
 * agree on the spelling, and one list is how that stays true.
 */
export const WAITLIST_STATUSES = [
  { id: "waiting", label: "Waiting" },
  { id: "invited", label: "Invited" },
  { id: "confirmed", label: "Confirmed" },
  { id: "declined", label: "Declined" },
] as const;

const STATUS_IDS: readonly string[] = WAITLIST_STATUSES.map((s) => s.id);

export function isWaitlistStatus(value: string): value is WaitlistStatus {
  return STATUS_IDS.includes(value);
}

/** Event details, in one place so the hero, the form and the stub agree. */
export const EVENT = {
  name: "Summer Sands",
  dateLine: "sun 27 sep · 2–5pm · bandra",
  stubDateLine: "sun 27 sep · 2–5pm",
} as const;

/**
 * Where the footer sends someone with a question.
 *
 * Resolved out of `BRAND_INSTAGRAMS` by handle rather than by index, so the
 * account this page points at survives someone reordering that list — and so
 * there is still only one place in the codebase that knows the URL.
 */
export const EVENT_INSTAGRAM = BRAND_INSTAGRAMS.find(
  (b) => b.handle === "@summersands.co"
) ?? BRAND_INSTAGRAMS[0];
