import { Suspense } from "react";

/**
 * Order confirmation, reached by a one-time token in the URL.
 *
 * There is nothing here to prerender and nothing to enumerate: the token *is*
 * the order, minted at checkout, and a shell built ahead of time could only
 * describe somebody else's purchase. So this defers to request time, while the
 * storefront chrome around it still comes from the static shell.
 *
 * The fallback is empty because the page's first act is to decide whether the
 * token resolves at all — a skeleton of an order that may turn out to be a 404
 * would be a worse first frame than nothing.
 */
export default function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
