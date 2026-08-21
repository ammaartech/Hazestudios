"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  ArrowRight,
  Clock,
  CornerDownLeft,
  ImageIcon,
  Layers,
  Loader2,
  Search,
  ShoppingCart,
  Tag,
  User,
  X,
} from "lucide-react";
import { buildGroups, type Group } from "@/lib/search/rank";
import {
  useRecentSearches,
  useRemoteSearch,
  useSearchIndex,
} from "@/lib/search/use-search";
import { segments } from "@/lib/search/fuzzy";
import { OPEN_SEARCH_EVENT } from "@/lib/search/open-search";
import type { Result, ResultKind } from "@/lib/search/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The admin's global search.
 *
 * Ranking lives in `@/lib/search` — this file is the surface: what opens it,
 * what it looks like, and how the keyboard drives it.
 *
 * The behaviour that decides whether it feels fast is the split between the two
 * tiers. Products, collections and pages are matched in the browser against a
 * prefetched index, so they repaint on the same frame as the keystroke. Orders
 * and customers come from Postgres 140 ms later and merge in underneath. The
 * list is therefore never empty while something is loading and never blocks on
 * the network — the slow half arrives late rather than making the fast half
 * wait for it.
 */

const ICON: Record<ResultKind, typeof Tag> = {
  product: Tag,
  collection: Layers,
  order: ShoppingCart,
  customer: User,
  page: ArrowRight,
};

export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * The highlighted row, stored together with the query it was chosen for.
   *
   * Pairing them is what makes the selection *derived* rather than something
   * an effect has to reset. A new query is a new result set, so a selection
   * belonging to the previous one is simply not read — no `useEffect`, no
   * cascading render, and no frame in which the highlight sits on row nine of
   * a four-row list.
   */
  const [selection, setSelection] = useState({ term: "", index: 0 });
  /**
   * True only while the keyboard is driving the list.
   *
   * Without it, the row under a stationary cursor steals the highlight the
   * moment the list re-renders beneath it — you press ↓, the list scrolls, and
   * the selection jumps back to wherever the mouse happens to be sitting.
   */
  const [keyboardNav, setKeyboardNav] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const index = useSearchIndex(open);
  const remote = useRemoteSearch(query, open);
  const [recents, remember, clearRecents] = useRecentSearches();

  const trimmed = query.trim();

  const groups = useMemo(
    () =>
      trimmed
        ? buildGroups({ query: trimmed, local: index.items, remote: remote.results })
        : [],
    [trimmed, index.items, remote.results]
  );

  /**
   * Every selectable row, in visual order.
   *
   * Arrow keys move through one flat list while the eye sees grouped sections —
   * pressing ↓ at the end of Products must land on the first order, not stop at
   * a heading. Flattening here keeps that mapping in one place instead of
   * spreading index arithmetic across the render.
   */
  const { rows, offsets } = useMemo(() => {
    const all = groups.flatMap((g) => g.items);

    // Where each group's first row sits in `rows`. Precomputed so the renderer
    // never has to mutate a running counter mid-JSX — the two must agree
    // exactly, since the keyboard indexes the flat list while the eye reads the
    // grouped one.
    const starts: number[] = [];
    let n = 0;
    for (const group of groups) {
      starts.push(n);
      n += group.items.length;
    }

    if (trimmed) {
      // The escape hatch, always last: the dropdown caps each group, and this is
      // how you reach everything it did not show. It is a real row so the
      // keyboard reaches it, and so pressing Enter on an empty result set does
      // something useful rather than nothing.
      all.push({
        kind: "page",
        id: "__all__",
        href: `/admin/products?q=${encodeURIComponent(trimmed)}`,
        title: `Search all products for “${trimmed}”`,
        score: -1,
      });
    }
    return { rows: all, offsets: starts };
  }, [groups, trimmed]);

  // Derived, never reset: a selection made against a different query, or one
  // pointing past the end of a list that has since shrunk, falls back to the
  // first row.
  const active =
    selection.term === trimmed && selection.index < rows.length
      ? selection.index
      : 0;

  /* ---------------------------------------------------------------------- */
  /* Opening                                                                 */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        (target instanceof HTMLElement &&
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

      // ⌘K / Ctrl+K — works from anywhere, including from inside another field,
      // which is the whole point of a global shortcut.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
        return;
      }

      // "/" is the same gesture without a modifier, and must not fire while
      // someone is writing a product description containing a slash.
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }

    // The mobile island and its "More" sheet have no keyboard to press ⌘K
    // with, so they ask for search through an event rather than by reaching
    // into this component's state. Keeps the island decoupled from the topbar,
    // which live in different halves of the layout tree.
    function onRequest() {
      setOpen(true);
      // The field is display:none until `open` on mobile, and focusing a
      // hidden input does nothing — so focus after the class flips.
      requestAnimationFrame(() => inputRef.current?.focus());
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_SEARCH_EVENT, onRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_SEARCH_EVENT, onRequest);
    };
  }, []);

  /*
   * Flags the open state on <body> so the mobile nav island can stand down.
   *
   * Not a z-index fight: the search field lives inside the topbar, which is
   * `fixed z-40` and therefore its own stacking context, so the panel's z-50 is
   * scoped *within* the header and can never paint above a sibling of it. The
   * island is exactly that sibling. Raising the header instead would put it
   * above the "More" sheet's scrim, trading one overlap for another.
   *
   * Standing the island down is also the better behaviour: full-screen search
   * is a modal context, and the bottom of the screen is where the keyboard is
   * about to be.
   */
  useEffect(() => {
    if (!open) return;
    document.body.dataset.adminSearch = "open";
    return () => {
      delete document.body.dataset.adminSearch;
    };
  }, [open]);

  // Clicking anywhere outside closes. Pointerdown rather than click, so the
  // panel is gone before the click lands on whatever is underneath.
  //
  // Measured against the whole control, not the panel: the panel does not exist
  // while the box is empty, so testing it would treat a click on the input
  // itself as a click outside — closing and immediately reopening on focus.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  /* ---------------------------------------------------------------------- */
  /* Navigating                                                              */
  /* ---------------------------------------------------------------------- */

  function go(result: Result, newTab = false) {
    remember(trimmed);
    if (newTab) {
      window.open(result.href, "_blank", "noopener");
      return;
    }
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(result.href);
  }

  function select(index: number) {
    setKeyboardNav(true);
    setSelection({ term: trimmed, index });
  }

  function move(delta: number) {
    if (rows.length === 0) return;
    // Wraps, so ↑ from the first row reaches the last — quicker than eleven
    // presses of ↓ to reach the escape hatch at the bottom.
    select((active + delta + rows.length) % rows.length);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        if (!trimmed) break;
        event.preventDefault();
        select(0);
        break;
      case "End":
        if (!trimmed) break;
        event.preventDefault();
        select(rows.length - 1);
        break;
      case "Enter": {
        const result = rows[active];
        if (!result) break;
        event.preventDefault();
        // ⌘/Ctrl+Enter opens in a new tab, matching what the same modifier does
        // on a link — useful when working through a list of orders.
        go(result, event.metaKey || event.ctrlKey);
        break;
      }
      case "Escape":
        event.preventDefault();
        // Escape backs out one step at a time: it clears the query first and
        // only closes an already-empty box, so a mistyped search does not cost
        // you the panel.
        if (trimmed) setQuery("");
        else {
          setOpen(false);
          inputRef.current?.blur();
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  // Keep the highlighted row on screen. `nearest` scrolls the minimum needed,
  // so arrowing down moves the list by one row rather than recentring it.
  useEffect(() => {
    if (!keyboardNav) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, keyboardNav]);

  const showPanel = open && (trimmed.length > 0 || recents.length > 0);

  return (
    /*
      Two shapes from one component.
      On desktop this is an inline field with a panel hanging under it. On a
      phone there is no room for that — a 36rem dropdown under a 390px field is
      the whole screen anyway — so once open it becomes a full-screen layer with
      the field pinned to the top, which is also what puts the results above the
      on-screen keyboard instead of behind it.

      Closed on mobile it collapses to nothing: the topbar shows a magnifier
      button instead, and that dispatches OPEN_SEARCH_EVENT.
    */
    <div
      ref={rootRef}
      className={cn(
        "pointer-events-auto",
        open
          ? "max-md:fixed max-md:inset-0 max-md:z-50 max-md:flex max-md:flex-col max-md:bg-background max-md:p-3 md:relative"
          : "relative max-md:hidden"
      )}
    >
      {/* Field row. On a phone the Cancel button sits beside the field, so the
          field itself needs its own positioned wrapper for the icon and the
          trailing affordances to anchor against. */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

          <input
            ref={inputRef}
            type="text"
            value={query}
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              showPanel && rows[active] ? `${listId}-${active}` : undefined
            }
            placeholder="Search products, orders, customers…"
            aria-label="Search the admin"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            /* `text-base` is load-bearing on iOS rather than a style choice:
               Safari zooms the page when a focused input is under 16px, and it
               does not zoom back out on blur. h-11 gives the 44px touch target
               both platforms ask for; desktop keeps the tighter 40px. */
            className="glass-control h-11 w-full rounded-lg border-0 pl-10 pr-20 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring/30 md:h-10 md:pr-24 md:text-sm"
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setKeyboardNav(false);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />

          {/* Trailing affordances. The spinner reports only the remote tier,
              which is the only thing that can actually be pending — products
              are already on screen by the time it appears. */}
          <div className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
            {remote.loading && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
            )}
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="pointer-events-auto flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-sidebar-hover hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            ) : (
              // 12px rather than 11: below 12 this sat under the legibility
              // floor, and a hint nobody can read is noise beside the
              // placeholder. Hidden on phones, which have no ⌘ key to offer.
              <kbd className="hidden rounded border border-sidebar-border bg-background px-1.5 py-0.5 font-sans text-[12px] font-medium text-muted-foreground md:inline">
                ⌘K
              </kbd>
            )}
          </div>
        </div>

        {/* Phones get an explicit way out; desktop closes on click-away or Esc. */}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
          className="h-11 shrink-0 cursor-pointer px-1 text-[15px] font-medium text-muted-foreground active:text-foreground md:hidden"
        >
          Cancel
        </button>
      </div>

      {showPanel && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Search results"
          /*
            `bg-popover` overrides the 86% tint `glass-floating` carries. That
            tint is right for the surfaces it was written for — a short menu, the
            bulk-selection toolbar — which float over a card with little behind
            them. This panel is up to 32rem of dense text hanging directly over
            the orders table, and at 86% the rows underneath read straight
            through it: customer names and status pills legibly crossing the
            result titles. A palette has to be readable before it is pretty, so
            it keeps the blur, the hairline and the lift, and drops the
            translucency.
          */
          className="overflow-y-auto overscroll-contain bg-popover py-1.5 text-foreground max-md:-mx-1 max-md:mt-2 max-md:flex-1 max-md:rounded-xl md:glass-floating md:absolute md:left-0 md:right-0 md:top-[calc(100%+6px)] md:max-h-[min(32rem,calc(100vh-5rem))] md:rounded-xl"
        >
          {!trimmed ? (
            <RecentList
              recents={recents}
              onPick={(term) => {
                setQuery(term);
                inputRef.current?.focus();
              }}
              onClear={clearRecents}
            />
          ) : (
            <>
              {/* Nothing matched, but the escape hatch below still renders —
                  so Enter runs the full product search rather than doing
                  nothing, which is the one thing an empty result set must not
                  do. */}
              {groups.length === 0 && (
                <Empty query={trimmed} loading={index.loading || remote.loading} />
              )}
              <Results
                groups={groups}
                rows={rows}
                active={active}
                listId={listId}
                offsets={offsets}
                onHover={(i) => {
                  // While the keyboard is driving, a stationary cursor must not
                  // steal the highlight from under the moving list.
                  if (!keyboardNav) setSelection({ term: trimmed, index: i });
                }}
                onPointerMove={() => setKeyboardNav(false)}
                onPick={go}
              />
            </>
          )}

          {index.error && (
            <p className="border-t px-3 py-2 text-[12px] text-muted-foreground">
              Catalogue search unavailable — showing pages and orders only.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Results({
  groups,
  rows,
  offsets,
  active,
  listId,
  onHover,
  onPointerMove,
  onPick,
}: {
  groups: Group[];
  rows: Result[];
  /** Index in `rows` of each group's first item, parallel to `groups`. */
  offsets: number[];
  active: number;
  listId: string;
  onHover: (index: number) => void;
  onPointerMove: () => void;
  onPick: (result: Result, newTab?: boolean) => void;
}) {
  return (
    <>
      {groups.map((group, groupIndex) => (
        <div key={group.kind} role="group" aria-label={group.label}>
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </p>
          {group.items.map((item, itemIndex) => {
            const index = offsets[groupIndex] + itemIndex;
            return (
              <Row
                key={`${item.kind}:${item.id}`}
                id={`${listId}-${index}`}
                result={item}
                active={index === active}
                onHover={() => onHover(index)}
                onPointerMove={onPointerMove}
                onPick={onPick}
              />
            );
          })}
        </div>
      ))}

      {/* The trailing escape hatch — the last entry of `rows`. */}
      <div className="mt-1 border-t pt-1">
        <Row
          id={`${listId}-${rows.length - 1}`}
          result={rows[rows.length - 1]}
          active={active === rows.length - 1}
          onHover={() => onHover(rows.length - 1)}
          onPointerMove={onPointerMove}
          onPick={onPick}
          muted
        />
      </div>
    </>
  );
}

function Row({
  id,
  result,
  active,
  onHover,
  onPointerMove,
  onPick,
  muted = false,
}: {
  id: string;
  result: Result;
  active: boolean;
  onHover: () => void;
  onPointerMove: () => void;
  onPick: (result: Result, newTab?: boolean) => void;
  muted?: boolean;
}) {
  const Icon = ICON[result.kind];
  const showThumb = result.kind === "product" || result.kind === "collection";

  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-active={active}
      tabIndex={-1}
      onMouseEnter={onHover}
      onPointerMove={onPointerMove}
      // Mousedown, not click: the input has focus, and a click would blur it
      // first — closing the panel out from under the row being clicked.
      onMouseDown={(event) => {
        event.preventDefault();
        onPick(result, event.metaKey || event.ctrlKey);
      }}
      className={cn(
        "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-100",
        active ? "bg-sidebar-selected" : "hover:bg-sidebar-hover"
      )}
    >
      {showThumb ? (
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {result.image ? (
            <Image
              src={result.image}
              alt=""
              width={36}
              height={36}
              sizes="36px"
              quality={60}
              className="size-full object-cover"
            />
          ) : (
            <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
          )}
        </span>
      ) : (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md",
            muted ? "text-muted-foreground" : "bg-muted text-muted-foreground"
          )}
        >
          {muted ? <Search className="size-4" /> : <Icon className="size-4" />}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[13.5px]",
            muted ? "text-muted-foreground" : "text-foreground"
          )}
        >
          <Highlighted text={result.title} ranges={result.ranges} />
        </span>
        {(result.subtitle || result.via) && (
          <span className="block truncate text-[12px] text-muted-foreground">
            {result.via && (
              // Says *why* a row is here when the match was not on its title —
              // without it, a product surfacing on a SKU or a tag looks like a
              // mistake.
              <span className="mr-1.5 rounded bg-muted px-1 py-px text-[10px] font-medium uppercase tracking-wide">
                {result.via}
              </span>
            )}
            {result.subtitle}
          </span>
        )}
      </span>

      {(result.meta || result.amount != null) && (
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-[12px]">
          {result.amount != null && (
            <span className="tabular-nums text-foreground">
              {formatMoney(result.amount)}
            </span>
          )}
          {result.meta && (
            <span className="text-muted-foreground">{result.meta}</span>
          )}
        </span>
      )}

      {active && (
        <CornerDownLeft
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
    </div>
  );
}

/**
 * Paints the characters that matched.
 *
 * The single strongest signal that a search understood you: seeing "Stus" bold
 * inside "Stussy Diced" answers "why is this here" before the question forms.
 * Ranges index the folded text, which is 1:1 with the original by construction,
 * so they apply to the source string with its casing and punctuation intact.
 */
function Highlighted({
  text,
  ranges,
}: {
  text: string;
  ranges?: [number, number][];
}) {
  if (!ranges?.length) return <>{text}</>;

  return (
    <>
      {segments(text, ranges).map((part, i) =>
        part.hit ? (
          <mark
            key={i}
            className="rounded-[3px] bg-transparent font-semibold text-foreground"
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

function RecentList({
  recents,
  onPick,
  onClear,
}: {
  recents: string[];
  onPick: (term: string) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recent
        </p>
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onClear();
          }}
          className="cursor-pointer text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          Clear
        </button>
      </div>
      {recents.map((term) => (
        <div
          key={term}
          role="option"
          aria-selected={false}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(term);
          }}
          className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-100 hover:bg-sidebar-hover"
        >
          <span className="flex size-9 shrink-0 items-center justify-center text-muted-foreground">
            <Clock className="size-4" />
          </span>
          <span className="truncate text-[13.5px]">{term}</span>
        </div>
      ))}
    </div>
  );
}

function Empty({ query, loading }: { query: string; loading: boolean }) {
  return (
    <div className="px-3 py-6 text-center">
      <p className="text-[13px] text-foreground">
        {loading ? "Searching…" : <>No matches for “{query}”</>}
      </p>
      {!loading && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          Try a product name, an order number, or a customer’s email.
        </p>
      )}
    </div>
  );
}
