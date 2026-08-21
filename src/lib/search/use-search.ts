"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { COMMAND_INDEX } from "./commands";
import {
  MIN_REMOTE_TERM,
  indexCollections,
  indexProducts,
  type IndexedItem,
  type Result,
  type SearchIndexPayload,
} from "./types";

/* -------------------------------------------------------------------------- */
/* The catalogue index                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Fetched at most once per page load, and shared by every consumer.
 *
 * A module-level promise rather than component state or a context, because the
 * admin is a client-routed app: the topbar unmounts and remounts as routes
 * change, and an index tied to a component's lifetime would be re-fetched and
 * re-prepared on every navigation. Living at module scope, it outlives all of
 * them — the fetch happens once, the first time somebody opens search, and
 * every later open is instant.
 */
let indexPromise: Promise<IndexedItem[]> | null = null;

async function loadIndex(): Promise<IndexedItem[]> {
  const response = await fetch("/api/admin/search-index");
  if (!response.ok) throw new Error(`Search index unavailable (${response.status})`);

  const payload = (await response.json()) as SearchIndexPayload;

  // Folding and word-boundary scanning happen here, once, rather than on every
  // keystroke — it is the reason a keystroke costs three milliseconds instead
  // of thirty.
  return [
    ...indexProducts(payload.products),
    ...indexCollections(payload.collections),
    ...COMMAND_INDEX,
  ];
}

export interface IndexState {
  items: IndexedItem[];
  loading: boolean;
  error: string | null;
}

/**
 * The searchable catalogue.
 *
 * `enabled` is what makes this lazy: nothing is fetched until the operator
 * actually opens search, so the admin's other forty pages pay nothing for a
 * feature they are not using. Once fetched it stays, so the second open — and
 * every open after a navigation — has the index already in hand.
 *
 * Commands are available before the fetch resolves, which matters more than it
 * sounds: they are the answer to "take me to settings", and that should not
 * wait on a product list.
 *
 * `loading` is derived rather than stored. Setting a flag at the top of the
 * effect and clearing it in the callback would be two extra renders to express
 * something already visible in the data — the index has either been swapped in
 * or it is still the bare command list.
 */
export function useSearchIndex(enabled: boolean): IndexState {
  const [loaded, setLoaded] = useState<{
    items: IndexedItem[];
    error: string | null;
  }>({ items: COMMAND_INDEX, error: null });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    indexPromise ??= loadIndex();

    // Both branches run from a promise callback, never synchronously in the
    // effect body, so neither can cascade a render.
    indexPromise.then(
      (items) => {
        if (!cancelled) setLoaded({ items, error: null });
      },
      (error: Error) => {
        if (cancelled) return;
        // Let the next open try again rather than caching the failure — this is
        // usually a dropped connection or an expired session, both of which fix
        // themselves.
        indexPromise = null;
        setLoaded({ items: COMMAND_INDEX, error: error.message });
      }
    );

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {
    items: loaded.items,
    loading: enabled && loaded.items === COMMAND_INDEX && loaded.error === null,
    error: loaded.error,
  };
}

/* -------------------------------------------------------------------------- */
/* The remote tier                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Long enough that a fast typist sends one request instead of eight, short
 * enough that results land while the query is still being read. The local tier
 * has already painted by this point, so this delay is never felt as emptiness —
 * only as orders and customers arriving a moment after products.
 */
const DEBOUNCE_MS = 140;

export interface RemoteState {
  results: Result[];
  loading: boolean;
}

const NO_RESULTS: Result[] = [];

/**
 * Orders, customers and SKUs, fetched as the query changes.
 *
 * Three details carry the responsiveness:
 *
 * **Every superseded request is aborted.** Without that, the reply to "stus"
 * can arrive after the reply to "stussy" and overwrite it — the classic
 * search-as-you-type race, which shows up as the dropdown flickering back to
 * older results. `AbortController` in the effect's cleanup means only the
 * current query is ever in flight.
 *
 * **Results are stored with the term they belong to,** so `loading` is simply
 * "the stored term is not the one on screen". No flag to set and clear, and no
 * way for the spinner to disagree with the list.
 *
 * **Previous results stay visible while the next request runs,** but only while
 * they still plausibly describe what is on screen — that is, while one of the
 * two terms extends the other. Typing forward through "sh → shr → shre" keeps
 * refining a visible list; clearing the box and typing something unrelated
 * drops the old rows immediately rather than showing answers to a question
 * nobody asked any more.
 */
export function useRemoteSearch(query: string, enabled: boolean): RemoteState {
  const [data, setData] = useState<{ term: string; results: Result[] }>({
    term: "",
    results: NO_RESULTS,
  });

  const q = query.trim();
  const usable = enabled && q.length >= MIN_REMOTE_TERM;

  useEffect(() => {
    if (!usable) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/admin/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : { results: [] }))
        .then((body: { results?: Result[] }) => {
          setData({ term: q, results: body.results ?? NO_RESULTS });
        })
        .catch((error: Error) => {
          // An abort is this effect superseding itself, not a failure — the
          // replacement request is already in flight and owns the state.
          if (error.name === "AbortError") return;
          setData({ term: q, results: NO_RESULTS });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, usable]);

  const related =
    data.term.length > 0 && (q.startsWith(data.term) || data.term.startsWith(q));

  return {
    results: usable && related ? data.results : NO_RESULTS,
    loading: usable && data.term !== q,
  };
}

/* -------------------------------------------------------------------------- */
/* Recent searches                                                             */
/* -------------------------------------------------------------------------- */

const RECENTS_KEY = "haze:admin:recent-searches";
const RECENTS_MAX = 6;

const NO_RECENTS: string[] = [];

/**
 * `localStorage` read through `useSyncExternalStore`.
 *
 * The obvious implementation — read it in a mount effect and `setState` — is
 * both a cascading render and a hydration hazard, since the value does not
 * exist during the server render. `useSyncExternalStore` is built for exactly
 * this shape: it takes a server snapshot (empty) and a client snapshot, and
 * React reconciles the two without the first paint disagreeing with the HTML.
 *
 * Subscribing to `storage` events is a free bonus: clearing recents in one
 * admin tab updates every other one.
 */
const recentsListeners = new Set<() => void>();

/**
 * Parsed snapshots must be referentially stable between reads or
 * `useSyncExternalStore` re-renders forever — it compares snapshots by
 * identity, and `JSON.parse` returns a new array every time. Caching against
 * the raw string means a fresh array is only minted when the stored text
 * actually changed.
 */
let recentsCache: { raw: string | null; parsed: string[] } = {
  raw: null,
  parsed: NO_RECENTS,
};

function readRecents(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(RECENTS_KEY);
  } catch {
    return NO_RECENTS;
  }

  if (raw === recentsCache.raw) return recentsCache.parsed;

  let parsed: string[] = NO_RECENTS;
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(value)) parsed = value.filter((v) => typeof v === "string");
  } catch {
    /* hand-edited or truncated — treat as absent */
  }

  recentsCache = { raw, parsed };
  return parsed;
}

function subscribeRecents(onChange: () => void) {
  recentsListeners.add(onChange);
  // `storage` only fires in *other* tabs, so same-tab writes notify explicitly.
  window.addEventListener("storage", onChange);
  return () => {
    recentsListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeRecents(next: string[] | null) {
  try {
    if (next) window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(RECENTS_KEY);
  } catch {
    /* private mode or quota — recents are a convenience, not a feature */
  }
  for (const listener of recentsListeners) listener();
}

/**
 * What to show before anything has been typed.
 *
 * An empty dropdown is a dead end, and the most likely next search is usually a
 * recent one — an operator working through a batch of orders returns to the
 * same customer and the same product repeatedly.
 */
export function useRecentSearches(): [
  recents: string[],
  remember: (term: string) => void,
  clear: () => void,
] {
  const recents = useSyncExternalStore(
    subscribeRecents,
    readRecents,
    () => NO_RECENTS
  );

  const remember = useCallback((term: string) => {
    const value = term.trim();
    if (!value) return;

    const previous = readRecents();
    // Case-insensitive dedupe, newest first, so re-running a search promotes it
    // instead of adding a near-duplicate row.
    writeRecents(
      [
        value,
        ...previous.filter((r) => r.toLowerCase() !== value.toLowerCase()),
      ].slice(0, RECENTS_MAX)
    );
  }, []);

  const clear = useCallback(() => writeRecents(null), []);

  return [recents, remember, clear];
}
