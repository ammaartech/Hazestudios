import type { Metadata } from "next";
import { Cormorant_Garamond, Courier_Prime, Poppins } from "next/font/google";
import { EVENT } from "@/lib/shop/waitlist";
import { WaitlistExperience } from "./waitlist-experience";

/**
 * /waitlist — the Summer Sands RSVP page.
 *
 * Deliberately *outside* the `(shop)` route group, so it does not inherit the
 * storefront shell. The campaign arrives with its own chrome (the fog mark
 * beside the Summer Sands wordmark), its own palette and a full-bleed
 * background, and dropping the store header, announcement bar, footer and
 * mobile tab bar on top of it would give the page two competing navigations and
 * two competing identities. A campaign landing page is a destination someone
 * arrives at from an Instagram link, not a stop inside the catalogue.
 *
 * The consequence worth knowing: nothing here has a cart, and `.shop`'s tokens
 * are not in scope. Both are intentional; the palette lives in the module.
 */

/*
  Three faces, loaded here rather than in the root layout so the rest of the
  site does not pay for a typeface only this page sets. `next/font` still
  self-hosts them and emits the CSS variables at build time, so there is no
  request to Google at runtime and no swap flash beyond the `swap` fallback.
*/
const display = Cormorant_Garamond({
  variable: "--font-wl-display",
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const mono = Courier_Prime({
  variable: "--font-wl-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const body = Poppins({
  variable: "--font-wl-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: `${EVENT.name} · Waitlist`,
  description:
    "Hand-paint a silk fan, letter a paper lantern, walk out with something that is only yours. Twenty seats, Sunday 27 September, Bandra.",
  openGraph: {
    title: `${EVENT.name} · Waitlist`,
    description:
      "A Sunday of hand-painted fans, paper lanterns and new friends. Twenty seats, one room, zero experience needed.",
    type: "website",
  },
};

/*
  Nothing is read here any more. The page used to await a `use cache`d seat
  count for the "20 seats · 18 left" line under the submit button; with that line
  gone there is no data on this route at all, so it is a static shell and the
  only thing the visitor waits for is the art. `getWaitlistStats` is left in
  place — the admin's own count is separate, and this is the obvious thing to
  call again if the counter comes back.
*/
export default function WaitlistPage() {
  return (
    <div className={`${display.variable} ${mono.variable} ${body.variable}`}>
      <WaitlistExperience />
    </div>
  );
}
