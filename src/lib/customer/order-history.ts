"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * This guest's recent orders on this device.
 *
 * Scope note: there is no customer login, so history is device-local and keyed
 * by QR token exactly like the cart. That means it is honest about what it is —
 * "orders placed from this phone at this table" — and it never claims to be an
 * account history the restaurant could look up.
 *
 * Only menu item ids, quantities and the guest's own note are kept. Prices are
 * deliberately not stored: a reorder is re-priced by the server from the live
 * menu, so a stale snapshot can never influence what the guest is charged.
 */
export interface HistoryLine {
  menuItemId: string;
  name: string;
  quantity: number;
  note?: string;
}

export interface HistoryOrder {
  /** Local record id — the tracking token is a credential and is not kept here. */
  id: string;
  orderNumber: string;
  total: string;
  currency: string;
  itemCount: number;
  tableLabel: string | null;
  placedAt: string;
  lines: HistoryLine[];
}

interface HistoryState {
  token: string | null;
  orders: HistoryOrder[];
  hydrateFor: (token: string) => void;
  remember: (token: string, order: HistoryOrder) => void;
  forget: (id: string) => void;
  clear: () => void;
}

/** Keeps localStorage bounded; a table only ever needs its last few visits. */
const HISTORY_LIMIT = 10;

export const useOrderHistory = create<HistoryState>()(
  persist(
    (set, get) => ({
      token: null,
      orders: [],
      hydrateFor: (token) => {
        if (get().token !== token) set({ token, orders: [] });
      },
      remember: (token, order) =>
        set((state) => {
          // Switching table mid-session must not leak the previous table's
          // history into this one.
          const base = state.token === token ? state.orders : [];
          const deduped = base.filter((entry) => entry.orderNumber !== order.orderNumber);
          return { token, orders: [order, ...deduped].slice(0, HISTORY_LIMIT) };
        }),
      forget: (id) => set((state) => ({ orders: state.orders.filter((entry) => entry.id !== id) })),
      clear: () => set({ orders: [] }),
    }),
    {
      name: "menupilot-order-history",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ token: state.token, orders: state.orders }),
    },
  ),
);

/**
 * Turns a past order into cart lines, dropping anything no longer on the menu.
 *
 * The dropped ids matter: a dish can be deleted or sold out between visits, and
 * silently re-adding a ghost line would let the guest submit a cart the server
 * then rejects. The caller shows the returned `unavailable` names instead.
 */
export function reorderLines(
  history: HistoryLine[],
  menuItems: { id: string; name: string }[],
): { lines: { menuItemId: string; quantity: number; note?: string }[]; unavailable: string[] } {
  const live = new Map(menuItems.map((item) => [item.id, item.name]));
  const lines: { menuItemId: string; quantity: number; note?: string }[] = [];
  const unavailable: string[] = [];

  for (const entry of history) {
    if (!live.has(entry.menuItemId)) {
      unavailable.push(entry.name);
      continue;
    }
    lines.push({
      menuItemId: entry.menuItemId,
      quantity: Math.min(99, Math.max(1, entry.quantity)),
      note: entry.note,
    });
  }

  return { lines, unavailable };
}
