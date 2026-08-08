"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  addToCart,
  clearCart as clearCartAction,
  refreshCart,
  setLineQuantity,
} from "@/app/(shop)/cart/actions";
import type { Cart, CartLine } from "@/lib/shop/cart";
import { track } from "@/lib/analytics/track";

/**
 * Client-side cart state.
 *
 * The server is the source of truth — every action returns a freshly resolved
 * cart and that return value *replaces* this state wholesale. Nothing here
 * computes a cart; it only holds the last one the server sent and shows an
 * optimistic guess while the next one is in flight.
 *
 * That is the whole reason this exists rather than revalidating the route on
 * every tap: the bag count lives in the layout, so a revalidation would re-run
 * the layout's collection and settings queries each time somebody nudges a
 * quantity. Passing the new cart back through React state updates the header,
 * the tab bar and the cart page from one round trip.
 */

/**
 * What the provider starts with before the server's cart arrives.
 *
 * Deliberately a local literal rather than the `EMPTY_CART` in `lib/shop/cart`:
 * that module imports `next/headers` and the service-role client, and pulling a
 * value (rather than a type) from it would drag all of that into the browser
 * bundle.
 */
const EMPTY: Cart = {
  lines: [],
  count: 0,
  subtotal: 0,
  currency: "INR",
  removed: [],
};

interface CartContextValue {
  cart: Cart;
  /** Total units in the bag. Reads optimistically, so the badge never lags. */
  count: number;
  isPending: boolean;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  /**
   * Adds to the bag without waiting for the server.
   *
   * The optional fields are not decoration: they are what the optimistic line
   * is drawn from, so the row that appears the instant the button is pressed is
   * the row the server will confirm. Omit them and the add still works — the
   * bag just does not move until the write returns.
   */
  add: (input: {
    productId: string;
    variantId?: string | null;
    quantity?: number;
    /** For the analytics beacon and the confirmation toast. */
    title?: string;
    optionLabel?: string;
    price?: number;
    /** Below: what the optimistic line needs to render like the real one. */
    handle?: string;
    image?: string | null;
    compareAt?: number | null;
    maxQuantity?: number | null;
  }) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  remove: (lineId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used inside <CartProvider>");
  }
  return context;
}

/* -------------------------------------------------------------------------- */

/**
 * The optimistic patches — every mutation the bag has, including adds.
 *
 * Adds used to be excluded, on the reasoning that a line's price, image and
 * stock ceiling all come from the database and a placeholder that swapped for a
 * real row would flicker. What that actually bought was a bag that did nothing
 * at all until the round trip landed: the button sat disabled reading "Adding…"
 * and the drawer opened late, which reads as a broken button rather than as
 * care. The flicker was also avoidable — the caller is a product page that
 * already has the title, image, price and stock ceiling on screen, so the
 * placeholder below is built from the same values the server will return and
 * there is nothing visible to swap.
 */
type Patch =
  | { type: "add"; line: CartLine }
  | { type: "quantity"; lineId: string; quantity: number }
  | { type: "clear" };

/** Recomputes the derived totals after any change to the lines. */
function withTotals(cart: Cart, lines: CartLine[]): Cart {
  return {
    ...cart,
    lines,
    count: lines.reduce((n, l) => n + (l.available ? l.quantity : 0), 0),
    subtotal: lines.reduce((n, l) => n + l.lineTotal, 0),
  };
}

function applyPatch(cart: Cart, patch: Patch): Cart {
  if (patch.type === "clear") {
    return { ...cart, lines: [], count: 0, subtotal: 0 };
  }

  if (patch.type === "add") {
    const incoming = patch.line;
    const match = (line: CartLine) =>
      line.productId === incoming.productId &&
      line.variantId === incoming.variantId;

    // Adding something already in the bag is a quantity change, not a second
    // row — which is what the server does too, so the guess survives the swap.
    if (cart.lines.some(match)) {
      return withTotals(
        cart,
        cart.lines.map((line) => {
          if (!match(line)) return line;
          const quantity = capped(
            line.quantity + incoming.quantity,
            line.maxQuantity
          );
          return {
            ...line,
            quantity,
            lineTotal: line.available ? line.price * quantity : 0,
          };
        })
      );
    }

    // Appended, not prepended: the server returns lines in `created_at` order,
    // so a new one lands at the bottom. Guessing the other end would make the
    // row jump the moment the real cart arrived.
    return withTotals(cart, [...cart.lines, incoming]);
  }

  const lines = cart.lines
    .map((line): CartLine => {
      if (line.id !== patch.lineId) return line;
      return {
        ...line,
        quantity: patch.quantity,
        lineTotal: line.available ? line.price * patch.quantity : 0,
      };
    })
    .filter((line) => line.quantity > 0);

  return withTotals(cart, lines);
}

/** Never guess past the stock ceiling; the server would only cap it back. */
function capped(quantity: number, max: number | null) {
  return max == null ? quantity : Math.min(quantity, max);
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<Cart>(EMPTY);
  const [optimisticCart, patch] = useOptimistic(cart, applyPatch);
  const [isPending, setIsPending] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /**
   * True while one of the actions below is in flight.
   *
   * A resync that lands mid-mutation describes the bag as it was *before* the
   * shopper's change and would silently discard it. Mutations return the full
   * resolved cart themselves, so skipping the resync loses nothing.
   *
   * A ref rather than the `isPending` state because the resync listener is
   * registered once and must read the current value, not the one captured when
   * the effect ran.
   */
  const pending = useRef(false);

  /** Keeps the ref the resync reads and the state the UI reads in step. */
  const markPending = useCallback((value: boolean) => {
    pending.current = value;
    setIsPending(value);
  }, []);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  /**
   * Read the bag from the server: once on mount, and again whenever the tab
   * comes back to the foreground.
   *
   * On mount, because the pages around this provider are fully static. The bag
   * is the one thing on the storefront keyed to a cookie, and resolving it on
   * the server — even inside a Suspense boundary — is enough to stop every
   * catalogue page being prerendered as plain HTML. It is not worth that: the
   * badge is a number in the corner, while the static shell is the difference
   * between a phone painting the page from the edge cache and waiting on a
   * render. So the bag is fetched from the client instead, after hydration.
   *
   * On refocus, because two things go stale while a tab sits in the background:
   * the shopper's other tab may have changed the bag, and stock may have moved
   * underneath it. Both end in the same bad moment — a checkout that rejects a
   * line the page still shows as available.
   */
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState !== "visible") return;
      if (pending.current) return;
      startTransition(async () => {
        try {
          setCart(await refreshCart());
        } catch {
          // Offline or mid-deploy. The cart on screen stays as it was, and the
          // next mutation returns server truth anyway.
        }
      });
    };

    resync();
    document.addEventListener("visibilitychange", resync);
    return () => document.removeEventListener("visibilitychange", resync);
  }, []);

  const add = useCallback<CartContextValue["add"]>(
    ({
      productId,
      variantId = null,
      quantity = 1,
      title,
      optionLabel,
      price,
      handle,
      image,
      compareAt = null,
      maxQuantity = null,
    }) => {
      /*
       * Everything the shopper perceives happens now, on the click, before a
       * single byte goes to the server: the drawer opens, the line is in it and
       * the badge has moved. The write below is bookkeeping that happens to be
       * watched.
       *
       * No success toast. The drawer is already open with the item, its option
       * and its price on screen — a toast saying the same thing in words is the
       * confirmation repeated, and it lands over the Checkout button while
       * doing it. Only failure gets announced, because only failure is
       * something the drawer cannot show by itself.
       */
      setDrawerOpen(true);
      markPending(true);

      startTransition(async () => {
        // Only guessable when the caller supplied enough to draw a real-looking
        // line. Without it the bag simply waits, as it always did, rather than
        // showing a row with holes in it.
        if (title && price != null) {
          patch({
            type: "add",
            line: {
              // Namespaced so it can never be mistaken for a server id. It only
              // exists between this click and the action returning; the real
              // cart replaces it wholesale.
              id: `optimistic:${productId}:${variantId ?? ""}`,
              productId,
              variantId,
              quantity: capped(quantity, maxQuantity),
              title,
              handle: handle ?? productId,
              variantTitle: optionLabel ?? "",
              price,
              compareAtPrice: compareAt,
              image: image ?? null,
              lineTotal: price * capped(quantity, maxQuantity),
              // Empty rather than guessed: the caller knows the variant it just
              // added, not its siblings. The real cart arrives with them a
              // moment later, and nothing renders a size menu from this line.
              options: [],
              optionNames: [],
              available: true,
              maxQuantity,
              reduced: false,
            },
          });
        }

        const result = await addToCart({ productId, variantId, quantity });
        setCart(result.cart);
        markPending(false);

        if (!result.ok) {
          // The guess is discarded with the transition, so the bag corrects
          // itself — the line the shopper just watched appear vanishes again,
          // which needs saying out loud or it reads as the drawer glitching.
          toast.error(result.error);
          return;
        }

        // Fired after the write succeeds, so the funnel counts real adds rather
        // than attempts. Fire-and-forget by design — see lib/analytics/track.
        track("add_to_cart", {
          productId,
          productTitle: title,
          value: price != null ? price * quantity : undefined,
        });
      });
    },
    [markPending, patch]
  );

  const setQuantity = useCallback<CartContextValue["setQuantity"]>(
    (lineId, quantity) => {
      markPending(true);

      startTransition(async () => {
        // Inside the transition so React keeps the guess on screen until the
        // action settles, then swaps it for the server's answer in one commit.
        patch({ type: "quantity", lineId, quantity });

        const result = await setLineQuantity(lineId, quantity);
        setCart(result.cart);
        markPending(false);

        if (!result.ok) toast.error(result.error);
      });
    },
    [markPending, patch]
  );

  const remove = useCallback<CartContextValue["remove"]>(
    (lineId) => setQuantity(lineId, 0),
    [setQuantity]
  );

  const clear = useCallback(() => {
    markPending(true);

    startTransition(async () => {
      patch({ type: "clear" });
      const result = await clearCartAction();
      setCart(result.cart);
      markPending(false);
      if (!result.ok) toast.error(result.error);
    });
  }, [markPending, patch]);

  const value = useMemo<CartContextValue>(
    () => ({
      cart: optimisticCart,
      count: optimisticCart.count,
      isPending,
      drawerOpen,
      openDrawer,
      closeDrawer,
      add,
      setQuantity,
      remove,
      clear,
    }),
    [
      optimisticCart,
      isPending,
      drawerOpen,
      openDrawer,
      closeDrawer,
      add,
      setQuantity,
      remove,
      clear,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
