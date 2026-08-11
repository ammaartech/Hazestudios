import type { Metadata, Viewport } from "next";
import { Geist_Mono, Rubik, Space_Mono, Work_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * The storefront's three faces, matching the Fogstores type system:
 * Work Sans sets body copy and navigation, Rubik sets headings, and Space Mono
 * sets the uppercase eyebrows — the announcement ticker and the small caps
 * labels that introduce each editorial block.
 */
const workSans = Work_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const rubik = Rubik({
  variable: "--font-display",
  subsets: ["latin"],
});

const spaceMono = Space_Mono({
  variable: "--font-subheading",
  subsets: ["latin"],
  weight: ["400", "700"],
});

// Retained for the admin, which keeps its own monospace for tabular figures.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Fogstores",
    template: "%s · Fogstores",
  },
  description:
    "Fogstores — mini-skirts, boots, studs and all things hot. Fall 2026.",
};

/**
 * Declared rather than inherited. These are the values Next emits by default,
 * so this changes no output — but the storefront's layout now depends on them
 * (the 16px form-control floor in globals.css is only meaningful against
 * `initial-scale=1`), and a contract the layout leans on should be visible in
 * the source rather than a framework default someone could later override
 * without realising what it was holding up.
 *
 * Deliberately absent, both of them:
 *
 * `maximumScale` / `userScalable: false` — locking zoom would have suppressed
 * the symptom this was reported as (Safari zooming a page that then pans
 * sideways) by taking pinch-to-zoom away from everyone who needs it. The cause
 * was form fields under 16px, and that is fixed at source instead; see the iOS
 * focus-zoom block in globals.css.
 *
 * `viewportFit: "cover"` — worth having, but as its own deliberate change, not
 * as a side effect of a bug fix. Under the default `auto`, iOS insets the
 * viewport to the safe area on its own, so the five `env(safe-area-inset-*)`
 * calls in the shell resolve to `0px` and are *correct* no-ops: the tab bar,
 * the sheets and the footer already clear the home indicator. Switching to
 * `cover` makes them live and buys an edge-to-edge bottom edge, but it also
 * puts landscape content under the notch until every page gutter carries
 * `env(safe-area-inset-left/right)` too — a change across most of the
 * storefront, and a design decision rather than a repair.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${workSans.variable} ${geistMono.variable} ${rubik.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors position="bottom-center" />
      </body>
    </html>
  );
}
