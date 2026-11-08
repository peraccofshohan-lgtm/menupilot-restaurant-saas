"use client";

import * as React from "react";
import Link from "next/link";
import { History, RotateCcw } from "lucide-react";
import { cx } from "@/components/ui";
import { formatMoney, timeAgo } from "@/lib/format";
import { useCart } from "@/lib/customer/cart";
import { reorderLines, useOrderHistory } from "@/lib/customer/order-history";
import { useT } from "@/lib/i18n/client";
import { formatNumber, formatReference } from "@/lib/format";

/**
 * "Your recent orders on this phone" — a local, honest history list.
 *
 * Reorder is a one-tap refill of the cart, never a resubmission: the guest still
 * reviews quantities, notes and the total before sending. Dishes that have left
 * the menu are dropped and named, so nothing silently disappears.
 */
export function OrderHistoryPanel({
  qrToken,
  menuItems,
}: {
  qrToken: string;
  menuItems: { id: string; name: string }[];
}) {
  const t = useT();
  const { token, orders, hydrateFor, forget } = useOrderHistory();
  const { hydrateFor: hydrateCart, add, lines } = useCart();
  const [flash, setFlash] = React.useState<string | null>(null);

  React.useEffect(() => {
    hydrateFor(qrToken);
  }, [hydrateFor, qrToken]);

  const scoped = token === qrToken ? orders : [];

  if (scoped.length === 0) return null;

  function reorder(orderId: string) {
    const entry = scoped.find((item) => item.id === orderId);
    if (!entry) return;

    const { lines: restored, unavailable } = reorderLines(entry.lines, menuItems);

    if (restored.length === 0) {
      setFlash(t("history.nothingAvailable", { number: formatReference(entry.orderNumber) }));
      return;
    }

    hydrateCart(qrToken);
    for (const line of restored) add(line.menuItemId, line.quantity, line.note);

    setFlash(
      unavailable.length > 0
        ? t("history.reorderedPartial", { count: formatNumber(restored.length), names: unavailable.join(", ") })
        : t("history.reordered", { count: formatNumber(restored.length) }),
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-ink-200 bg-white p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-900">
          <History className="size-3.5 text-ink-400" aria-hidden />
          {t("history.title")}
        </h2>
        <span className="text-[10.5px] text-ink-400">{t("history.onThisPhone")}</span>
      </div>

      {flash ? (
        <p role="status" className="mt-2 rounded-lg bg-moss-50 px-2.5 py-1.5 text-[11.5px] text-moss-700">
          {flash}
        </p>
      ) : null}

      <ul className="mt-2 divide-y divide-ink-100">
        {scoped.map((entry) => {
          const items = entry.lines.map((line) => `${line.quantity}× ${line.name}`).join(", ");
          return (
            <li key={entry.id} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-ink-800">
                    {entry.orderNumber}
                    {entry.tableLabel ? <span className="font-normal text-ink-400"> · {entry.tableLabel}</span> : null}
                  </p>
                  <p className="truncate text-[11px] text-ink-500">{items}</p>
                  <p className="text-[10.5px] text-ink-400">
                    {timeAgo(entry.placedAt)} · {formatMoney(entry.total, entry.currency)} · {formatNumber(entry.itemCount)} {t("unit.items")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => reorder(entry.id)}
                    className={cx(
                      "inline-flex items-center gap-1 rounded-lg border border-clay-300 bg-clay-50 px-2 py-1 text-[11px] font-semibold text-clay-700",
                      "hover:bg-clay-100",
                    )}
                  >
                    <RotateCcw className="size-3" aria-hidden />
                    {t("history.reorder")}
                  </button>
                  <button
                    type="button"
                    onClick={() => forget(entry.id)}
                    aria-label={t("history.remove", { number: formatReference(entry.orderNumber) })}
                    className="rounded-lg px-1.5 py-1 text-[13px] leading-none text-ink-300 hover:bg-ink-100 hover:text-ink-500"
                  >
                    ×
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {lines.length > 0 ? (
        <p className="mt-2 text-[10.5px] text-ink-400">
          {t("history.cartSaved")}
        </p>
      ) : (
        <p className="mt-2 text-[10.5px] text-ink-400">
          {t("history.reorderHint")}{" "}
          <Link href="#menu" className="text-clay-700 hover:underline">
            {t("history.viewMenu")}
          </Link>
        </p>
      )}
    </section>
  );
}
