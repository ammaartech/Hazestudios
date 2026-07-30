import { Suspense } from "react";

/**
 * One boundary for the whole account area.
 *
 * Every page under `/account` resolves the signed-in shopper first — most of
 * them through `requireAccount`, which reads the session cookie and redirects
 * if there isn't one. That is request-time data by definition: there is no
 * shared version of "your orders" to prerender, and no amount of restructuring
 * would produce one.
 *
 * Declaring it once here says that plainly, and keeps the seven pages beneath
 * it free of boilerplate they would all repeat identically. The storefront
 * chrome around this — header, nav, footer, tab bar — still comes from the
 * static shell, so a shopper opening their account on a slow connection sees
 * the site immediately and their details a moment later.
 *
 * The fallback is empty on purpose. These pages branch on who you are before
 * they render anything (signed out → redirect, unverified → a notice, otherwise
 * → the page), so any skeleton would be guessing at a shape it cannot know.
 */
export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
