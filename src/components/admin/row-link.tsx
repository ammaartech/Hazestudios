"use client";

import Link, { type LinkProps } from "next/link";
import { useState } from "react";

/**
 * A `<Link>` for list rows: prefetches on intent, not on sight.
 *
 * `next/link` prefetches every link that enters the viewport. On a list page
 * that is fifty row links, and each prefetch is a request the server has to
 * authenticate and render the shell for — a page view of /admin/orders was
 * producing 116 such requests, most of them for rows nobody would click. Rows
 * prefetch here on hover or touch instead, which is what Next's own guide
 * recommends for large lists, and still lands well before the click.
 *
 * Navigation chrome (the sidebar, pagination, back links) keeps the default:
 * those are few, and the whole point of them is to be instant.
 */
export function RowLink({
  children,
  ...props
}: LinkProps & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
  children: React.ReactNode;
}) {
  const [intent, setIntent] = useState(false);
  const arm = () => setIntent(true);

  return (
    <Link
      {...props}
      // `null` restores the default prefetch once the user shows intent.
      prefetch={intent ? null : false}
      onMouseEnter={(e) => {
        arm();
        props.onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        arm();
        props.onTouchStart?.(e);
      }}
      onFocus={(e) => {
        arm();
        props.onFocus?.(e);
      }}
    >
      {children}
    </Link>
  );
}
