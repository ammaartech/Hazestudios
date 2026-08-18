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

/**
 * The card people see when they paste the link into WhatsApp or Instagram.
 *
 * `metadataBase` matters more than it looks: without it a relative `og:image`
 * has nothing to be resolved against, and Next falls back to localhost — which
 * is a URL WhatsApp's crawler cannot fetch, so the card silently arrives with no
 * picture at all. `NEXT_PUBLIC_SITE_URL` first (the same override the checkout
 * uses for its return URLs), then Vercel's own hostname for preview and
 * production deploys, then localhost so `next dev` does not throw.
 *
 * `title.absolute` opts out of the root layout's `%s · Fogstores` template. The
 * campaign shares under its own name, and "hobbymaxx · waitlist · Fogstores"
 * would be the third name on a card that only has room for one.
 *
 * The image is 1080 × 1440, not the 1200 × 630 the OG spec suggests. It is
 * shared into WhatsApp and Instagram far more than into anything that renders a
 * wide card, and both show a portrait image whole — where a 1.91:1 crop of this
 * one would cut the headline off at the top and bottom. JPEG rather than the
 * WebP everything else on this page uses, because the crawlers that build these
 * previews are the last place WebP support can be assumed.
 */
const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

const SHARE_TITLE = "hobbymaxx · waitlist";

const SHARE_DESCRIPTION =
  "Two activities, great food, a bedazzling station and a polaroid to take home. Put your name down for the next one.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { absolute: SHARE_TITLE },
  description: SHARE_DESCRIPTION,
  openGraph: {
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    type: "website",
    images: [
      {
        url: "/waitlist/share-card.jpg",
        width: 1080,
        height: 1440,
        alt: `${EVENT.name} — things to do in Bangalore instead of doomscrolling`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    images: ["/waitlist/share-card.jpg"],
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
