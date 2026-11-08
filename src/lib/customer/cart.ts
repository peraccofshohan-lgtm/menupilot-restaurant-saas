"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Guest cart.
 *
 * Stored per QR token so two tables sharing a phone browser never mix carts, and
 * persisted so an accidental refresh does not lose the order. Only ids, quantities
 * and notes are stored: prices are always re-read and re-totalled by the server.
 */
export interface CartLine {
  menuItemId: string;
  quantity: number;
  note?: string;
}

interface CartState {
  token: string | null;
  lines: CartLine[];
  hydrateFor: (token: string) => void;
  add: (menuItemId: string, quantity?: number, note?: string) => void;
  setQuantity: (menuItemId: string, quantity: number) => void;
  setNote: (menuItemId: string, note: string) => void;
  remove: (menuItemId: string) => void;
  clear: () => void;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      token: null,
      lines: [],
      hydrateFor: (token) => {
        if (get().token !== token) set({ token, lines: [] });
      },
      add: (menuItemId, quantity = 1, note) =>
        set((state) => {
          const existing = state.lines.find((line) => line.menuItemId === menuItemId);
          if (existing) {
            return {
              lines: state.lines.map((line) =>
                line.menuItemId === menuItemId
                  ? { ...line, quantity: Math.min(99, line.quantity + quantity), note: note ?? line.note }
                  : line,
              ),
            };
          }
          return { lines: [...state.lines, { menuItemId, quantity: Math.min(99, quantity), note }] };
        }),
      setQuantity: (menuItemId, quantity) =>
        set((state) => ({
          lines:
            quantity <= 0
              ? state.lines.filter((line) => line.menuItemId !== menuItemId)
              : state.lines.map((line) =>
                  line.menuItemId === menuItemId ? { ...line, quantity: Math.min(99, quantity) } : line,
                ),
        })),
      setNote: (menuItemId, note) =>
        set((state) => ({
          lines: state.lines.map((line) =>
            line.menuItemId === menuItemId ? { ...line, note: note.slice(0, 200) } : line,
          ),
        })),
      remove: (menuItemId) =>
        set((state) => ({ lines: state.lines.filter((line) => line.menuItemId !== menuItemId) })),
      clear: () => set({ lines: [] }),
    }),
    {
      name: "menupilot-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ token: state.token, lines: state.lines }),
    },
  ),
);

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}
