"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidateWaitlist } from "@/lib/shop/cache";
import {
  craftTicketLabel,
  isCraftId,
  CRAFTS,
  CRAFT_NOTE_MAX,
  NAME_MAX,
  OTHER_CRAFT,
} from "@/lib/shop/waitlist";

/**
 * Summer Sands waitlist sign-up.
 *
 * `waitlist_entries` grants nothing to `anon` (0024_waitlist.sql) — a public
 * insert policy would let anyone write rows into the attendee list — so the
 * write is privileged and every rule about what may go into a row lives here
 * rather than in a policy.
 *
 * Unlike the newsletter action, this one is *not* incurious about whether the
 * address is already known: it hands back the queue position, which is the
 * whole point of the page, and it hands back the same number to the same person
 * every time. That does make the form an oracle for "is this address on the
 * list" — a deliberate trade, because the alternative is that someone who
 * refreshes and re-submits gets a second row and a worse place in a queue they
 * were already in. What is leaked is membership of a public event waitlist, and
 * nothing about the person is echoed back beyond what the caller just typed.
 */

export interface WaitlistState {
  ok: boolean;
  /** Field-level messages, keyed by input name. */
  errors?: { name?: string; email?: string; phone?: string };
  /** Only on success — everything the confirmation stub prints. */
  entry?: {
    position: number;
    handleLabel: string;
    craftLabel: string;
  };
  /** Only on failure that isn't field-specific. */
  message?: string;
}

// Deliberately permissive, and the same expression the newsletter action uses:
// the only thing worth rejecting here is a value that plainly is not an
// address. Deliverability is the ESP's problem.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Longest address the RFC allows; also what the column is sized for in practice. */
const EMAIL_MAX = 254;

/**
 * Collapses whitespace and strips the control characters a paste can carry.
 *
 * Not a charset filter: a name is the one field on this form where the range of
 * legitimate input is the whole of Unicode, so rejecting anything outside a
 * Latin alphabet would turn away real people. What is removed is only what
 * cannot be part of a name in any script — newlines, tabs and control codes,
 * which exist here to break the admin table and the CSV, not to spell anything.
 */
function normaliseName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}

function field(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Reduces whatever was typed to something that could actually be an Instagram
 * handle: their charset is letters, digits, dots and underscores, capped at 30.
 *
 * The leading '@' goes because the form already draws one as a prefix, so a
 * person who types it anyway would otherwise be stored as '@@name'. The
 * charset filter is what stops the field being a place to park arbitrary text —
 * this is an optional, unverified field on a public form, and the admin renders
 * it as a link to `instagram.com/<handle>` and ships it to a CSV. Neither
 * should have to cope with a value that was never a handle. Anything with
 * nothing valid left in it is stored as empty rather than as debris.
 */
function normaliseHandle(raw: string): string {
  const cleaned = raw
    .replace(/^@+/, "")
    .replace(/[^A-Za-z0-9._]/g, "")
    .slice(0, 30);
  // A run of dots is not a handle either, and reads as a path traversal.
  return /[A-Za-z0-9_]/.test(cleaned) ? cleaned : "";
}

export async function joinWaitlist(
  _prev: WaitlistState | null,
  formData: FormData
): Promise<WaitlistState> {
  const name = normaliseName(field(formData, "name"));
  const email = field(formData, "email").toLowerCase();
  const phone = field(formData, "phone");
  const instagram = normaliseHandle(field(formData, "instagram"));
  const craftRaw = field(formData, "craft");

  const errors: NonNullable<WaitlistState["errors"]> = {};

  // One character is a name in plenty of places; nothing at all is not.
  if (!name) {
    errors.name = "We'd like to know who to expect.";
  }

  if (!EMAIL.test(email) || email.length > EMAIL_MAX) {
    errors.email = "A real email, please — that's where the seat goes.";
  }

  // Count digits rather than pattern-match a format: "+91 98765 43210",
  // "09876543210" and "+44 7700 900123" are all fine, and anything with fewer
  // than eight digits in it is not a phone number in any of them.
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    errors.phone = "We text the address the night before.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // An unrecognised craft is a tampered payload, not a user error — there is no
  // field to attach a message to, and the `check` constraint would reject the
  // insert anyway. Fall back to the default rather than failing the sign-up.
  const craft = isCraftId(craftRaw) ? craftRaw : CRAFTS[0].id;

  // Only 'other' carries a note, and the check constraint in 0025 says the same
  // thing — a note left over from a chip they changed their mind about would
  // otherwise be stored beside a craft it does not describe.
  const craftNote =
    craft === OTHER_CRAFT
      ? normaliseName(field(formData, "craftNote")).slice(0, CRAFT_NOTE_MAX)
      : "";

  const supabase = createAdminClient();
  if (!supabase) {
    return { ok: false, message: "Sign-ups are unavailable right now." };
  }

  // `upsert` on the unique email, rather than read-then-insert: two tabs
  // submitting at once would both pass a read and one would take a unique
  // violation. `position` is deliberately absent from the payload — it is an
  // identity column, so Postgres assigns it on first insert and the conflict
  // path leaves it alone. That is what makes a returning attendee keep their
  // original number instead of being pushed to the back for fixing a typo.
  const { data, error } = await supabase
    .from("waitlist_entries")
    .upsert(
      {
        name,
        email,
        phone,
        instagram,
        craft,
        craft_note: craftNote,
        source: "waitlist-page",
      },
      { onConflict: "email" }
    )
    .select("position")
    .single();

  if (error || !data) {
    return { ok: false, message: "Something went wrong. Try again." };
  }

  // The seats-left line on the page is a cached count; it is now one behind.
  revalidateWaitlist();

  return {
    ok: true,
    entry: {
      position: data.position,
      // The handle if they gave one, then the name they typed, then the local
      // part of the address — the stub always names *someone*.
      handleLabel: instagram
        ? `@${instagram}`
        : name || email.split("@")[0] || "you",
      craftLabel: craftTicketLabel(craft),
    },
  };
}
