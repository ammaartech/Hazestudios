import Link from "next/link";
import {
  BRAND_INSTAGRAMS,
  FOOTER_LINKS,
  NEWSLETTER,
  QUICK_LINKS,
} from "@/lib/shop/home-content";
import { NewsletterForm } from "./newsletter-form";

/**
 * Brand marks, drawn inline. lucide dropped its brand set in 1.x, and pulling a
 * second icon package in for three glyphs would cost more than the glyphs.
 */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[1.15rem]"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const SOCIALS = [
  {
    label: "Instagram",
    href: BRAND_INSTAGRAMS[0].href,
    icon: () => (
      <Glyph>
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
      </Glyph>
    ),
  },
  {
    label: "TikTok",
    href: "https://tiktok.com",
    icon: () => (
      <Glyph>
        <path d="M9.5 11.2a4.4 4.4 0 1 0 4.4 4.4V3.5a5.6 5.6 0 0 0 5.6 5.6" />
      </Glyph>
    ),
  },
  {
    label: "Facebook",
    href: "https://facebook.com",
    icon: () => (
      <Glyph>
        <path d="M17.5 2.5H15a5 5 0 0 0-5 5v3H7v4h3v7h4v-7h3l1-4h-4v-3a1 1 0 0 1 1-1h2.5z" />
      </Glyph>
    ),
  },
];

/** Accepted cards, as wordmark chips rather than reproductions of the marks. */
const PAYMENTS = ["Visa", "Mastercard", "Amex", "PayPal", "Diners", "Discover"];

/**
 * Storefront footer. Inverted — this is the one place the storefront goes dark,
 * which is what ends the page rather than letting the last section trail off
 * into white.
 */
export function ShopFooter({ storeName }: { storeName: string }) {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 bg-[var(--shop-ink)] text-white">
      {/* Extra bottom padding on mobile clears the floating tab bar, including
          the home-indicator inset on notched phones. */}
      <div className="px-4 pb-[calc(env(safe-area-inset-bottom,0px)+7rem)] pt-16 md:px-8 md:pb-16 md:pt-20">
        <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <nav aria-labelledby="footer-store">
            <h2 id="footer-store" className="meta text-white">
              {storeName}
            </h2>
            <ul className="mt-6 flex flex-col gap-3.5">
              {FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <FooterLink {...link} />
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="meta text-white">{NEWSLETTER.heading}</h2>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-white/65">
              {NEWSLETTER.body}
            </p>
            <div className="mt-6">
              <NewsletterForm />
            </div>
          </div>

          <nav aria-labelledby="footer-quick">
            <h2 id="footer-quick" className="meta text-white">
              Quick Links
            </h2>
            <ul className="mt-6 flex flex-col gap-3.5">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <FooterLink {...link} />
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="meta text-white">Brands Instagram</h2>
            <ul className="mt-6 flex flex-col gap-3.5">
              {BRAND_INSTAGRAMS.map((brand) => (
                <li key={brand.handle}>
                  <a
                    href={brand.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="cursor-pointer text-sm text-white/80 underline underline-offset-4 transition-colors duration-200 hover:text-white"
                  >
                    {brand.handle}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Base line                                                         */}
        {/* ---------------------------------------------------------------- */}
        <div className="mt-16 flex flex-col gap-8 border-t border-white/15 pt-8 md:flex-row md:items-center md:justify-between">
          <ul className="flex items-center gap-1">
            {SOCIALS.map(({ label, href, icon: Icon }) => (
              <li key={label}>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={label}
                  className="glass-press flex size-10 cursor-pointer items-center justify-center rounded-full text-white/70 transition-colors duration-300 hover:bg-white/10 hover:text-white"
                >
                  <Icon />
                </a>
              </li>
            ))}
          </ul>

          <p className="text-xs text-white/50">
            © {year} {storeName}. All rights reserved.
          </p>

          <ul className="flex flex-wrap items-center gap-1.5" aria-label="Accepted payment methods">
            {PAYMENTS.map((brand) => (
              <li
                key={brand}
                className="rounded-[3px] bg-white/90 px-2 py-1 text-[0.5625rem] font-semibold uppercase tracking-wide text-[var(--shop-ink)]"
              >
                {brand}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="cursor-pointer text-sm text-white/65 transition-colors duration-200 hover:text-white"
    >
      {label}
    </Link>
  );
}
