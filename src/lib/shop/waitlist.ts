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
 * The things you can come for, in the order they appear on the page.
 *
 * `id` is what the database stores and the action validates. `label` is the
 * chip. `ticket` is the single word printed on the confirmation stub, kept
 * separate because "beaded keychain" does not fit in a 34px display face.
 *
 * `other` is the one that behaves differently: choosing it reveals a text
 * field, and what someone types there is stored in `craft_note` rather than in
 * `craft`. That split is deliberate — `craft` stays a closed set the check
 * constraint can police and the admin can filter on, and the open-ended
 * suggestion sits beside it as free text nobody has to parse.
 */
export const CRAFTS = [
  { id: "fan", label: "paper fan", ticket: "fan" },
  { id: "lantern", label: "paper lantern", ticket: "lantern" },
  { id: "movie", label: "movie night", ticket: "movie night" },
  { id: "keychain", label: "beaded keychain", ticket: "keychain" },
  { id: "polaroid", label: "polaroid holder", ticket: "polaroid" },
  { id: "other", label: "other", ticket: "their own thing" },
] as const;

export type CraftId = (typeof CRAFTS)[number]["id"];

/** The chip that opens the free-text field. */
export const OTHER_CRAFT: CraftId = "other";

/** Long enough for a suggestion, short enough not to be a comment box. */
export const CRAFT_NOTE_MAX = 80;

/** A name is required; this is the ceiling the column and the action share. */
export const NAME_MAX = 80;

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
 * The Saturdays and Sundays the workshop runs.
 *
 * Two fields rather than one string so the card can set the date and the
 * weekday in different faces without the component splitting text it was
 * handed. Order is the order they are shown.
 */
export const UPCOMING_DATES = [
  { date: "September 6th", day: "Sunday" },
  { date: "September 12th", day: "Saturday" },
  { date: "September 13th", day: "Sunday" },
] as const;

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

/**
 * The store behind the event, beside it in the footer.
 *
 * Resolved the same way and from the same list, so the two pills cannot drift
 * apart or point at a URL nothing else in the codebase knows about.
 */
export const STORE_INSTAGRAM = BRAND_INSTAGRAMS.find(
  (b) => b.handle === "@fogstores.co"
) ?? BRAND_INSTAGRAMS[0];
