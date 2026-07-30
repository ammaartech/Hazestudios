"use client";

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";

/**
 * The search box, filled from the URL on the client.
 *
 * The obvious implementation is a server-rendered `defaultValue={term}` read
 * from `searchParams` — but `searchParams` is request-time data, so that would
 * drag the form out of the prerendered shell and behind a Suspense boundary.
 * The form is the most important interactive thing on this page and the thing a
 * shopper on a slow phone most wants immediately; making it wait on the network
 * to show a value it could read from the address bar is the wrong trade.
 *
 * So the markup is static and the value is restored at hydration. Without
 * JavaScript the box is simply empty and the form still submits, which is the
 * same behaviour a plain HTML search form has always had.
 */
export function SearchField() {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && input.current) input.current.value = q;
  }, []);

  return (
    <form action="/search" method="get" className="relative mx-auto mt-8 max-w-lg">
      <label htmlFor="q" className="sr-only">
        Search for products on our site
      </label>
      <Search
        className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-(--shop-stone)"
        aria-hidden
      />
      <input
        ref={input}
        id="q"
        name="q"
        type="search"
        autoFocus
        placeholder="Search for products on our site"
        className="h-14 w-full rounded-full border border-(--shop-hairline) bg-transparent pl-12 pr-6 text-sm text-(--shop-ink) placeholder:text-(--shop-stone) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--shop-ink)"
      />
    </form>
  );
}
