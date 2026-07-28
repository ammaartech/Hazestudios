import type { Metadata } from "next";
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
