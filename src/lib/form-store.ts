"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A field-granular form store.
 *
 * The problem it solves: a large editor held in `useState` re-renders every
 * field, every derived `useMemo`, and every table row on each keystroke. On the
 * product editor that meant recomputing the variant cartesian product while the
 * operator typed a title, which is what made typing feel like it stalled.
 *
 * Here, mutable state lives outside React and components subscribe per field via
 * `useSyncExternalStore`. Typing in Title notifies exactly the components that
 * read `title` — the variant table does not re-render at all.
 *
 * Single-field snapshots are the stored values themselves, so they stay
 * referentially stable between notifications — which is what
 * `useSyncExternalStore` requires. Multi-field reads use a version counter for
 * the same reason (see `useFields`).
 */

type Listener = () => void;

/** Structural compare, used only on dirty-checks — never in the render path. */
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export class FormStore<T extends Record<string, unknown>> {
  private state: T;
  private base: T;
  private fieldListeners = new Map<keyof T, Set<Listener>>();
  private metaListeners = new Set<Listener>();
  private dirtyKeys = new Set<keyof T>();
  /** Monotonic per-field write counter — the basis for multi-field snapshots. */
  private versions = new Map<keyof T, number>();

  constructor(initial: T) {
    this.state = { ...initial };
    this.base = structuredClone(initial);
  }

  /**
   * Strictly-increasing token for a set of fields.
   *
   * `useFields` needs a snapshot that is referentially stable between changes.
   * A cached object can't be it — caching means mutating after render, which
   * the React Compiler correctly rejects. A summed version is a primitive, so
   * it compares by value and needs no cache at all.
   */
  versionOf(keys: readonly (keyof T)[]): number {
    let sum = 0;
    for (const key of keys) sum += this.versions.get(key) ?? 0;
    return sum;
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.state[key];
  }

  /** Full snapshot. Allocates, so call it on save — not during render. */
  snapshot(): T {
    return { ...this.state };
  }

  baseline<K extends keyof T>(key: K): T[K] {
    return this.base[key];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    if (Object.is(this.state[key], value)) return;
    this.state = { ...this.state, [key]: value };

    const wasDirty = this.dirtyKeys.size > 0;
    if (equal(value, this.base[key])) this.dirtyKeys.delete(key);
    else this.dirtyKeys.add(key);

    this.notifyField(key);
    if (wasDirty !== this.dirtyKeys.size > 0) this.notifyMeta();
  }

  /** Functional update, for fields derived from their own previous value. */
  update<K extends keyof T>(key: K, fn: (prev: T[K]) => T[K]): void {
    this.set(key, fn(this.state[key]));
  }

  patch(values: Partial<T>): void {
    for (const key of Object.keys(values) as (keyof T)[]) {
      this.set(key, values[key] as T[keyof T]);
    }
  }

  /** Adopt `next` as both current state and the new clean baseline (post-save). */
  commit(next: T): void {
    const changed = (Object.keys({ ...this.state, ...next }) as (keyof T)[]).filter(
      (k) => !Object.is(this.state[k], next[k])
    );
    this.state = { ...next };
    this.base = structuredClone(next);
    this.dirtyKeys.clear();
    changed.forEach((k) => this.notifyField(k));
    this.notifyMeta();
  }

  /** Throw away edits and return to the last committed baseline. */
  reset(): void {
    this.commit(structuredClone(this.base));
  }

  isDirty(): boolean {
    return this.dirtyKeys.size > 0;
  }

  dirtyFields(): (keyof T)[] {
    return [...this.dirtyKeys];
  }

  subscribeField(key: keyof T, listener: Listener): () => void {
    let set = this.fieldListeners.get(key);
    if (!set) {
      set = new Set();
      this.fieldListeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  subscribeMeta(listener: Listener): () => void {
    this.metaListeners.add(listener);
    return () => {
      this.metaListeners.delete(listener);
    };
  }

  private notifyField(key: keyof T) {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    this.fieldListeners.get(key)?.forEach((l) => l());
  }

  private notifyMeta() {
    this.metaListeners.forEach((l) => l());
  }
}

/** Subscribe to one field. Returns a `useState`-shaped tuple. */
export function useField<T extends Record<string, unknown>, K extends keyof T>(
  store: FormStore<T>,
  key: K
): [T[K], (value: T[K]) => void] {
  const read = useCallback(() => store.get(key), [store, key]);
  const value = useSyncExternalStore(
    useCallback((cb) => store.subscribeField(key, cb), [store, key]),
    read,
    read
  );
  const setValue = useCallback(
    (next: T[K]) => store.set(key, next),
    [store, key]
  );
  return [value, setValue];
}

/** Read several fields at once — for derived UI like profit or the SEO preview. */
export function useFields<T extends Record<string, unknown>, K extends keyof T>(
  store: FormStore<T>,
  keys: readonly K[]
): Pick<T, K> {
  // `keys` is a fresh array every render, so it cannot be a dependency. The
  // joined token is its stable identity; the callbacks split it back out so
  // they close over nothing unstable.
  const keyToken = keys.join(" ");

  const subscribe = useCallback(
    (cb: Listener) => {
      const offs = (keyToken.split(" ") as K[]).map((k) =>
        store.subscribeField(k, cb)
      );
      return () => offs.forEach((off) => off());
    },
    [store, keyToken]
  );

  // The snapshot is a number, not an assembled object. An object snapshot has
  // to be cached to stay referentially stable, and caching means writing to a
  // closure after render — which the React Compiler rejects, rightly. A summed
  // per-field version compares by value and needs no cache at all.
  const getVersion = useCallback(
    () => store.versionOf(keyToken.split(" ") as K[]),
    [store, keyToken]
  );

  useSyncExternalStore(subscribe, getVersion, getVersion);

  // Read during render, after subscribing. A fresh object per render is fine
  // here: it is a return value, not something React diffs.
  return Object.fromEntries(keys.map((k) => [k, store.get(k)])) as Pick<T, K>;
}

/** True while the form differs from its last committed baseline. */
export function useIsDirty<T extends Record<string, unknown>>(
  store: FormStore<T>
): boolean {
  const read = useCallback(() => store.isDirty(), [store]);
  return useSyncExternalStore(
    useCallback((cb) => store.subscribeMeta(cb), [store]),
    read,
    read
  );
}
