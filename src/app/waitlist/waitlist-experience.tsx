"use client";

import {
  Fragment,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { joinWaitlist, type WaitlistState } from "./actions";
import { playClaimChime } from "./chime";
import { downloadTicket } from "./ticket-image";
import {
  BURST_PETALS,
  DRIFTING_BLOOMS,
  FOG_MARK,
  WAX_SEAL,
  WORDMARK,
} from "./art";
import {
  CRAFTS,
  CRAFT_NOTE_MAX,
  EVENT,
  EVENT_INSTAGRAM,
  NAME_MAX,
  OTHER_CRAFT,
  STORE_INSTAGRAM,
  UPCOMING_DATES,
  type CraftId,
} from "@/lib/shop/waitlist";
import styles from "./waitlist.module.css";

/**
 * The waitlist page, as a three-act state machine.
 *
 *   closed  → a sealed envelope, and nothing else to do but open it
 *   opening → the seal breaks, the flap lifts, the letter rises, the scene goes
 *   open    → the event details beside the RSVP form, or the stub if you're in
 *
 * The opening act is choreographed entirely in CSS (see `waitlist.module.css`);
 * the only thing this component owns about it is when it ends. The two numbers
 * below are that contract and have to stay in step with the delays over there.
 */
const OPEN_MS = 1570;

/**
 * Under reduced motion the sequence does not play, so waiting out its full
 * duration would be a second and a half of nothing. Long enough to read as a
 * response to the click, short enough not to be a wait.
 */
const OPEN_MS_REDUCED = 140;

/** Typed out one character at a time when the form arrives. */
const FORM_TITLE = "Put your name\non the list";
const TYPE_MS = 52;

type Stage = "closed" | "opening" | "open";

interface SavedSeat {
  position: number;
  handleLabel: string;
  craftLabel: string;
}

/* ---------------------------------------------------------------------------
   The claimed seat, as an external store
   ---------------------------------------------------------------------------
   A seat lives in `localStorage` so that closing the tab does not lose the
   number someone was told to screenshot. That makes it genuinely external
   state, and it is read with `useSyncExternalStore` rather than copied into
   React state by a mount effect.

   Two things fall out of that, both of which the effect version got wrong:
   `getServerSnapshot` returns null, so the server renders the envelope and
   hydration cannot mismatch; and because the store is the single source of
   truth, "start over" is a write rather than a second piece of state that has
   to be kept in agreement with the first.
--------------------------------------------------------------------------- */

/** Where a claimed seat is remembered. */
const STORAGE_KEY = "fogstores:summer-sands:seat";

/** `storage` only fires in *other* tabs, so writes here announce themselves. */
const SEAT_EVENT = "fogstores:seat-change";

function readRawSeat(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode, or storage disabled. A seat that cannot be remembered is
    // still worth showing for the length of this visit.
    return null;
  }
}

function writeSeat(seat: SavedSeat | null): void {
  try {
    if (seat) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seat));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Fall through: the event below still updates this tab.
  }
  window.dispatchEvent(new Event(SEAT_EVENT));
}

function subscribeSeat(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(SEAT_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SEAT_EVENT, onChange);
  };
}

function parseSeat(raw: string | null): SavedSeat | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as SavedSeat).position === "number"
    ) {
      return parsed as SavedSeat;
    }
  } catch {
    // Something that isn't ours under our key.
  }
  return null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function WaitlistExperience() {
  const [stage, setStage] = useState<Stage>("closed");
  const [craft, setCraft] = useState<CraftId>(CRAFTS[0].id);

  const rawSeat = useSyncExternalStore(subscribeSeat, readRawSeat, () => null);
  const seat = useMemo(() => parseSeat(rawSeat), [rawSeat]);

  /*
    The server action, wrapped so a win is written to the store as part of the
    same transition that delivers it — not afterwards from an effect, which
    would paint one frame of an empty form between the two.

    The cost is that the form no longer works without JavaScript. That is
    already true of the page as a whole: the form is behind an envelope you have
    to click open, so there is no no-JS path to it to protect.
  */
  const [state, formAction, pending] = useActionState<
    WaitlistState | null,
    FormData
  >(async (prev, formData) => {
    const result = await joinWaitlist(prev, formData);
    if (result.ok && result.entry) writeSeat(result.entry);
    return result;
  }, null);

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    };
  }, []);

  const open = useCallback(() => {
    if (stage !== "closed") return;
    setStage("opening");
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(
      () => setStage("open"),
      prefersReducedMotion() ? OPEN_MS_REDUCED : OPEN_MS,
    );
  }, [stage]);

  const reset = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    writeSeat(null);
    setStage("closed");
    setCraft(CRAFTS[0].id);
  }, []);

  // Holding a seat means the invitation is already open, whatever the stage
  // machine last did — that is what a returning visitor lands on.
  const current: Stage = seat ? "open" : stage;
  const isClosed = current === "closed";
  const isOpening = current === "opening";

  return (
    // The ref is how the ticket renderer reads the resolved `--font-wl-*`
    // values: `next/font` mints the real family names at build time, so they
    // can only be read back off an element that inherits them.
    <div className={styles.page} ref={rootRef}>
      <div className={styles.wash} />

      {/* Purely decorative, and hidden from assistive tech accordingly. */}
      <div className={styles.ambient} aria-hidden>
        {DRIFTING_BLOOMS.map((bloom, i) => (
          <Image
            key={i}
            src={bloom.src}
            width={bloom.width}
            height={bloom.height}
            alt=""
            className={styles.bloom}
            style={
              {
                "--wl-x": bloom.x,
                "--wl-size": bloom.size,
                "--wl-dur": bloom.duration,
                "--wl-delay": bloom.delay,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/*
        The two marks above the fold. `priority` on both because the wordmark is
        the page's LCP element and the fog mark is on the same row — letting
        them queue behind the fourteen decorative blooms below would be exactly
        backwards.
      */}
      <header className={styles.masthead}>
        <div className={styles.mastheadLeft}>
          <Image
            src={FOG_MARK.src}
            width={FOG_MARK.width}
            height={FOG_MARK.height}
            alt="Fogstores"
            priority
            className={styles.fogMark}
          />
        </div>
        <Image
          src={WORDMARK.src}
          width={WORDMARK.width}
          height={WORDMARK.height}
          alt={EVENT.name}
          priority
          className={styles.wordmark}
        />
      </header>

      {current !== "open" ? (
        <section
          className={`${styles.invite} ${isOpening ? styles.inviteLeaving : ""}`}
        >
          <h1 className={styles.inviteHeading}>
            try something
            <br />
            <em>you&rsquo;ve never</em> done before
          </h1>
          {/*
            A real button. The original was a `div` with `role="button"`, a
            `tabIndex` and a hand-written Enter/Space handler — three things a
            `<button>` gets right for free, including the disabled state that
            stops a second click landing mid-animation.
          */}
          <button
            type="button"
            className={styles.envelope}
            onClick={open}
            disabled={isOpening}
            aria-label="Open the invitation"
          >
            {isOpening ? (
              <span className={styles.envelopeLetter} aria-hidden>
                <span className={styles.letterRuleLead} />
                <span className={styles.letterRule} style={{ width: "86%" }} />
                <span className={styles.letterRule} style={{ width: "72%" }} />
                <span className={styles.letterRule} style={{ width: "58%" }} />
              </span>
            ) : null}

            <span className={styles.envelopeBody} aria-hidden>
              <span className={styles.panelLeft} />
              <span className={styles.panelRight} />
              <span className={styles.panelFront} />
              <span
                className={`${styles.flap} ${isOpening ? styles.flapOpening : ""}`}
              />
              <span className={styles.envelopeSheen} />
            </span>

            {isClosed ? (
              <span className={styles.seal} aria-hidden>
                <span className={styles.sealRing} />
                <Image
                  src={WAX_SEAL.src}
                  width={WAX_SEAL.width}
                  height={WAX_SEAL.height}
                  alt=""
                  className={styles.sealImg}
                />
              </span>
            ) : (
              <Image
                src={WAX_SEAL.src}
                width={WAX_SEAL.width}
                height={WAX_SEAL.height}
                alt=""
                aria-hidden
                className={`${styles.seal} ${styles.sealBreaking}`}
              />
            )}
          </button>

          {isClosed ? (
            <span className={styles.tapHint}>tap to open</span>
          ) : null}
        </section>
      ) : (
        <>
          <div className={styles.open}>
            <div className={styles.detailCol}>
              <div className={styles.notepad}>
                <span className={styles.tapeLeft} aria-hidden />
                <span className={styles.tapeRight} aria-hidden />
                <p className={styles.notepadTitle}>every event includes</p>
                <ul className={styles.notepadList}>
                  {[
                    "2 activities",
                    "great food",
                    "bedazzling station <3",
                    "a polaroid click to take home",
                  ].map((item) => (
                    <li key={item} className={styles.notepadItem}>
                      <span className={styles.tick} aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.social}>
                <div className={styles.avatars} aria-hidden>
                  <span
                    className={styles.avatar}
                    style={{
                      background: "linear-gradient(150deg,#ffd9e5,#e793b0)",
                    }}
                  />
                  <span
                    className={styles.avatar}
                    style={{
                      background: "linear-gradient(150deg,#ffe7ef,#d97e9e)",
                    }}
                  />
                  <span
                    className={styles.avatar}
                    style={{
                      background: "linear-gradient(150deg,#ffd0e0,#c96a8c)",
                    }}
                  />
                </div>
                <p className={styles.socialCopy}>
                  be in a room full of interesting people who love all the same
                  things you do.
                </p>
              </div>
            </div>

            {seat ? (
              <Stub seat={seat} onReset={reset} rootRef={rootRef} />
            ) : (
              <div className={styles.formCol}>
                <form className={styles.form} action={formAction}>
                  <span className={styles.formTape} aria-hidden />
                  <p className={styles.eyebrow}>rsvp / waitlist</p>

                  <TypedTitle />

                  <p className={styles.formNote}>
                    Be the first to get ticket access when slots open up.
                  </p>

                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Name</span>
                    <input
                      name="name"
                      type="text"
                      required
                      maxLength={NAME_MAX}
                      autoComplete="name"
                      placeholder="what should we call you"
                      className={styles.input}
                      aria-invalid={state?.errors?.name ? true : undefined}
                      aria-describedby={
                        state?.errors?.name ? "wl-name-error" : undefined
                      }
                    />
                    {state?.errors?.name ? (
                      <span
                        id="wl-name-error"
                        role="alert"
                        className={styles.error}
                      >
                        {state.errors.name}
                      </span>
                    ) : null}
                  </label>

                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Username</span>
                    <span className={styles.prefixWrap}>
                      <span className={styles.prefix} aria-hidden>
                        @
                      </span>
                      <input
                        name="instagram"
                        type="text"
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="yourhandle"
                        className={styles.prefixInput}
                        aria-describedby="wl-ig-hint"
                      />
                    </span>
                    <span id="wl-ig-hint" className={styles.hint}>
                      so we can tag you in the photos
                    </span>
                  </label>

                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Number</span>
                    <input
                      name="phone"
                      type="tel"
                      required
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+91 98••• •••••"
                      className={styles.input}
                      aria-invalid={state?.errors?.phone ? true : undefined}
                      aria-describedby={
                        state?.errors?.phone ? "wl-phone-error" : undefined
                      }
                    />
                    {state?.errors?.phone ? (
                      <span
                        id="wl-phone-error"
                        role="alert"
                        className={styles.error}
                      >
                        {state.errors.phone}
                      </span>
                    ) : null}
                  </label>

                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Email</span>
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@lovely.com"
                      className={styles.input}
                      aria-invalid={state?.errors?.email ? true : undefined}
                      aria-describedby={
                        state?.errors?.email ? "wl-email-error" : undefined
                      }
                    />
                    {state?.errors?.email ? (
                      <span
                        id="wl-email-error"
                        role="alert"
                        className={styles.error}
                      >
                        {state.errors.email}
                      </span>
                    ) : null}
                  </label>

                  {/*
                    The chips are the control; this carries their value into the
                    FormData. A `<select>` would be the conventional answer, but
                    these have to wrap onto two rows and read as a row of paper
                    tags, which a select cannot do.
                  */}
                  <input type="hidden" name="craft" value={craft} />
                  <fieldset className={styles.chips}>
                    <legend className={styles.fieldLabel}>
                      Most excited for
                    </legend>
                    <div className={styles.chipRow}>
                      {CRAFTS.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setCraft(c.id)}
                          aria-pressed={craft === c.id}
                          className={`${styles.chip} ${
                            craft === c.id ? styles.chipOn : ""
                          }`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>

                    {/*
                      Revealed rather than always present, and only mounted while
                      'other' is the selection — so the value cannot survive a
                      change of mind and arrive in the payload beside a craft it
                      does not describe. `autoFocus` is safe here because the
                      mount is a direct response to a tap on the chip.
                    */}
                    {craft === OTHER_CRAFT ? (
                      <label className={styles.otherField}>
                        <span className={styles.fieldLabel}>
                          What would you like to do?
                        </span>
                        <input
                          name="craftNote"
                          type="text"
                          autoFocus
                          maxLength={CRAFT_NOTE_MAX}
                          autoComplete="off"
                          placeholder="tell us what you'd love to make"
                          className={styles.input}
                        />
                      </label>
                    ) : null}
                  </fieldset>

                  <button
                    type="submit"
                    className={styles.submit}
                    disabled={pending}
                    onClick={(e) => {
                      /*
                        Only when the browser is actually going to submit. A
                        failed `required`/`type=email` check leaves the form
                        exactly where it is, and a confirmation sound for a form
                        that did not go anywhere tells the person the opposite of
                        what happened.
                      */
                      if (e.currentTarget.form?.checkValidity()) {
                        playClaimChime();
                      }
                    }}
                  >
                    <span className={styles.sheen} aria-hidden />
                    <span className={styles.submitLabel}>
                      {pending ? "sealing your letter…" : "claim my seat"}
                    </span>
                  </button>

                  {/* Only the failure now. The seat count that used to live
                      here is gone, and the submit button already says what is
                      happening while the action runs. */}
                  {state?.message ? (
                    <p
                      role="alert"
                      className={`${styles.error} ${styles.seatsLine}`}
                    >
                      {state.message}
                    </p>
                  ) : null}
                </form>

                <UpcomingDates />
              </div>
            )}
          </div>

          <Ticker />
        </>
      )}

      <PageFooter />
    </div>
  );
}

/**
 * The dates the workshop actually runs, under the form.
 *
 * A card of its own rather than a line inside the form: the form is a thing you
 * fill in, and a list of dates is a thing you read. Sharing the paper would
 * make the dates look like another field.
 */
function UpcomingDates() {
  return (
    <aside className={styles.dates}>
      <span className={styles.datesTape} aria-hidden />
      <p className={styles.datesTitle}>upcoming dates</p>
      <ul className={styles.datesList}>
        {UPCOMING_DATES.map((d) => (
          <li key={`${d.date}-${d.day}`} className={styles.datesItem}>
            <span className={styles.datesDate}>{d.date}</span>
            <span className={styles.datesDay}>{d.day}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * The form's heading, typed out.
 *
 * A component of its own so the animation begins when the form mounts, without
 * an effect having to reset state on a stage change. It is never server
 * rendered — the form only exists after a click — so seeding from `matchMedia`
 * in the initialiser cannot cause a hydration mismatch.
 */
function TypedTitle() {
  const [shown, setShown] = useState(() =>
    prefersReducedMotion() ? FORM_TITLE.length : 0,
  );
  const done = shown >= FORM_TITLE.length;

  useEffect(() => {
    if (done) return;
    const id = setInterval(
      () => setShown((n) => Math.min(n + 1, FORM_TITLE.length)),
      TYPE_MS,
    );
    return () => clearInterval(id);
  }, [done]);

  return (
    <h2 className={styles.formTitle}>
      {/* The animation is decoration of a heading that never changes, so the
          finished string is what gets announced — not one character at a time. */}
      <span aria-hidden>{FORM_TITLE.slice(0, shown)}</span>
      {!done ? <span className={styles.caret} aria-hidden /> : null}
      <span className="sr-only">{FORM_TITLE}</span>
    </h2>
  );
}

/**
 * Drawn inline, and the same path data as the storefront footer's mark.
 * lucide dropped its brand set in 1.x, and a second icon package for one glyph
 * would cost more than the glyph.
 */
function InstagramGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4.25"
      aria-hidden
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The page footer: who this is, and how to reach a person about it.
 *
 * Rendered outside the stage machine, so it is there whether someone is looking
 * at the sealed envelope or their claimed seat — a page whose only support
 * channel appears after you have already signed up is no use to the person
 * still deciding.
 */
function PageFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerMarks}>
        <Image
          src={FOG_MARK.src}
          width={FOG_MARK.width}
          height={FOG_MARK.height}
          alt="Fogstores"
          className={styles.footerFog}
        />
        <span className={styles.footerDivider} aria-hidden />
        <Image
          src={WORDMARK.src}
          width={WORDMARK.width}
          height={WORDMARK.height}
          alt={EVENT.name}
          className={styles.footerWordmark}
        />
      </div>

      <p className={styles.footerCopy}>
        For more info or help, message us on Instagram.
      </p>

      {/*
        Two accounts, one row: the campaign's, and the store's. Both are the
        same control rather than one pill and one text link — they are the same
        kind of destination, and giving one of them a louder treatment would
        suggest they are not.
      */}
      <div className={styles.footerLinks}>
        {[EVENT_INSTAGRAM, STORE_INSTAGRAM].map((account) => (
          <a
            key={account.handle}
            href={account.href}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.footerLink}
            /* The visible label is the handle; the icon is decoration beside
               it, so the accessible name says what following it will do. */
            aria-label={`Instagram, ${account.handle} (opens in a new tab)`}
          >
            <span className={styles.footerIcon} aria-hidden>
              <InstagramGlyph />
            </span>
            <span aria-hidden>{account.handle}</span>
          </a>
        ))}
      </div>
    </footer>
  );
}

/** The confirmation stub — "you're on the list", and the seat to keep. */
function Stub({
  seat,
  onReset,
  rootRef,
}: {
  seat: SavedSeat;
  onReset: () => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const root = rootRef.current;
      if (!root) throw new Error("The page is not ready yet");
      await downloadTicket(root, seat);
    } catch {
      // A screenshot was the fallback before this button existed, and it still
      // is — so the failure message points at something that will work rather
      // than asking them to try again.
      toast.error("Could not save the ticket", {
        description: "Take a screenshot of this screen instead.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.ticketWrap}>
      <div className={styles.burst} aria-hidden>
        {BURST_PETALS.map((petal, i) => (
          <Image
            key={i}
            src={petal.src}
            width={petal.width}
            height={petal.height}
            alt=""
            className={styles.burstPetal}
            style={
              {
                "--wl-size": petal.size,
                "--wl-bx": petal.bx,
                "--wl-by": petal.by,
                "--wl-dur": petal.duration,
                "--wl-delay": petal.delay,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className={styles.ticket}>
        <div className={styles.ticketTop}>
          <p className={styles.ticketEyebrow}>
            admit one · {EVENT.name.toLowerCase()}
          </p>
          <h2 className={styles.ticketTitle}>
            You&rsquo;re on
            <br />
            the list.
          </h2>
          {/*
            The one thing a visitor is waiting to be told, and the form that
            would have said it is gone from the DOM — so it is announced as well
            as rendered. A sibling live region rather than `role="status"` on the
            heading, which would have replaced the heading role and dropped the
            stub out of the document outline.
          */}
          <p role="status" className="sr-only">
            You&rsquo;re on the list. Number {seat.position} in line, under{" "}
            {seat.handleLabel}.
          </p>
          <p className={styles.ticketBody}>
            We sealed your letter. Watch your inbox — and your DMs — for the
            address.
          </p>

          <dl className={styles.ticketStats}>
            <div>
              <dt className={styles.statLabel}>in line</dt>
              <dd className={styles.statValue}>#{seat.position}</dd>
            </div>
            <div>
              <dt className={styles.statLabel}>under</dt>
              <dd className={styles.statValue}>{seat.handleLabel}</dd>
            </div>
            <div>
              <dt className={styles.statLabel}>craft</dt>
              <dd className={styles.statValue}>{seat.craftLabel}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.perforation} aria-hidden />

        <div className={styles.ticketFoot}>
          <div>
            <p className={styles.ticketDate}>{EVENT.stubDateLine}</p>
            <div className={styles.barcode} aria-hidden />
          </div>
          <Image
            src={WAX_SEAL.src}
            width={WAX_SEAL.width}
            height={WAX_SEAL.height}
            alt=""
            aria-hidden
            className={styles.ticketSeal}
          />
        </div>
      </div>

      <div className={styles.ticketFooterRow}>
        <p className={styles.ticketFooterNote}>
          Save it — show this at the door on the day.
        </p>
        <div className={styles.ticketActions}>
          <button
            type="button"
            className={styles.download}
            onClick={save}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-3.5" aria-hidden />
            )}
            {saving ? "saving…" : "save ticket"}
          </button>
          <button type="button" className={styles.reset} onClick={onReset}>
            start over
          </button>
        </div>
      </div>
    </div>
  );
}

const TICKER_WORDS = [
  "make new friends",
  "limited seats only",
  "art is free therapy",
  "reconnect with your inner child",
];

/**
 * Two identical tracks translating as one: when the first has travelled its own
 * width the animation restarts and the second is exactly where the first began,
 * so the seam is never visible and nothing has to be measured at runtime.
 */
function Ticker() {
  /*
    Both tracks carry the animation class and both must be direct children of
    the flex container — wrapping the copy in a plain div to hide it would make
    *that* the flex item and collapse the layout. The duplicate is hidden from
    assistive tech instead, so each phrase is announced once.
  */
  const track = (duplicate: boolean) => (
    <div className={styles.tickerTrack} aria-hidden={duplicate || undefined}>
      {TICKER_WORDS.map((word) => (
        <Fragment key={word}>
          <span>{word}</span>
          <span aria-hidden>·</span>
        </Fragment>
      ))}
    </div>
  );

  return (
    <div className={styles.ticker}>
      {track(false)}
      {track(true)}
    </div>
  );
}
