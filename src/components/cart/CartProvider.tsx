"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  ApiError,
  ensureGuestSession,
  newIdempotencyKey,
} from "@/lib/api-client";
import type { Cart } from "@/lib/types";

// Client cart state. The server cart is authoritative: every change goes through the
// API with the current version and the UI re-renders from the server's answer (no
// optimistic money or stock changes, UX-CONTRACT).

type CartContextValue = {
  cart: Cart | null;
  status: "loading" | "ready" | "error";
  count: number;
  refresh: () => Promise<Cart | null>;
  setLine: (variantId: string, quantity: number) => Promise<Cart>;
  removeLine: (variantId: string) => Promise<Cart>;
  replaceLine: (
    variantId: string,
    replacementVariantId: string,
  ) => Promise<Cart>;
  announce: (message: string) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [status, setStatus] = useState<CartContextValue["status"]>("loading");
  const [message, setMessage] = useState("");
  const cartRef = useRef<Cart | null>(null);

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  const refresh = useCallback(async () => {
    try {
      await ensureGuestSession();
      const next = await api<Cart>("/cart");
      setCart(next);
      setStatus("ready");
      return next;
    } catch {
      setStatus("error");
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    // Deferred so the initial load runs after commit (no synchronous setState in the effect).
    void Promise.resolve().then(() => (active ? refresh() : null));
    return () => {
      active = false;
    };
  }, [refresh]);

  const mutate = useCallback(
    async (run: (current: Cart, key: string) => Promise<Cart>) => {
      await ensureGuestSession();
      const current = cartRef.current ?? (await refresh());
      if (!current)
        throw new ApiError(
          0,
          "NETWORK",
          "We couldn't load your cart. Please try again.",
        );
      const key = newIdempotencyKey();
      try {
        const next = await run(current, key);
        cartRef.current = next;
        setCart(next);
        return next;
      } catch (error) {
        // A stale version means another tab changed the cart: reload, let the shopper retry.
        if (
          error instanceof ApiError &&
          (error.code === "VERSION_CONFLICT" ||
            error.code === "PAYMENT_UNRESOLVED" ||
            error.status === 0)
        )
          await refresh();
        throw error;
      }
    },
    [refresh],
  );

  const setLine = useCallback(
    (variantId: string, quantity: number) =>
      mutate((current, key) =>
        api<Cart>("/cart/lines", {
          method: "POST",
          idempotencyKey: key,
          body: { variantId, quantity, expectedVersion: current.version },
        }),
      ),
    [mutate],
  );

  const removeLine = useCallback(
    (variantId: string) =>
      mutate((current, key) =>
        api<Cart>(`/cart/lines/${variantId}`, {
          method: "DELETE",
          idempotencyKey: key,
          body: { expectedVersion: current.version },
        }),
      ),
    [mutate],
  );

  const replaceLine = useCallback(
    (variantId: string, replacementVariantId: string) =>
      mutate((current, key) =>
        api<Cart>("/cart/lines/" + variantId, {
          method: "PATCH",
          idempotencyKey: key,
          body: { replacementVariantId, expectedVersion: current.version },
        }),
      ),
    [mutate],
  );

  const announce = useCallback((text: string) => {
    setMessage("");
    window.setTimeout(() => setMessage(text), 50);
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      status,
      count: cart?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0,
      refresh,
      setLine,
      removeLine,
      replaceLine,
      announce,
    }),
    [cart, status, refresh, setLine, removeLine, replaceLine, announce],
  );

  return (
    <CartContext.Provider value={value}>
      {children}
      <div
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {message}
      </div>
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside CartProvider");
  return value;
}
