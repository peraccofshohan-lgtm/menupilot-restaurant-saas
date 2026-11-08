"use client";

import * as React from "react";
import { CircleCheck, Star } from "lucide-react";
import { ReviewSheet } from "./review-sheet";
import { useT } from "@/lib/i18n/client";
import { formatNumber } from "@/lib/format";

/**
 * The "rate your meal" list on the tracking page.
 *
 * Which dishes are still reviewable is decided on the server (the database
 * returns the ids already reviewed for this order); this component only renders
 * what it was given and opens the sheet.
 */
export function ReviewControls({
  token,
  items,
  restaurantReviewed,
}: {
  token: string;
  items: { menuItemId: string; name: string; reviewed: boolean }[];
  restaurantReviewed: boolean;
}) {
  const t = useT();
  const [sheet, setSheet] = React.useState<{ kind: "item" | "restaurant"; menuItemId?: string; name?: string } | null>(null);

  const pending = items.filter((item) => !item.reviewed);

  return (
    <div>
      <ul className="mt-3 divide-y divide-ink-100">
        {items.map((item) => (
          <li key={item.menuItemId} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate text-[12.5px] text-ink-800">{item.name}</span>
            {item.reviewed ? (
              <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-moss-700">
                <CircleCheck className="size-3.5" aria-hidden /> {t("review.alreadyRated")}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setSheet({ kind: "item", menuItemId: item.menuItemId, name: item.name })}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1 text-[11.5px] font-medium text-ink-700 hover:border-clay-300 hover:bg-clay-50/60"
              >
                <Star className="size-3 text-amber-500" aria-hidden /> {t("review.rateDish")}
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-ink-50/50 p-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-ink-800">{t("review.restaurantTitle")}</p>
          <p className="text-[11px] text-ink-500">{t("review.service")} · {t("review.staff")} · {t("review.cleanliness")}</p>
        </div>
        {restaurantReviewed ? (
          <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-moss-700">
            <CircleCheck className="size-3.5" aria-hidden /> Reviewed
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setSheet({ kind: "restaurant" })}
            className="shrink-0 rounded-lg bg-clay-600 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-clay-700"
          >
            {t("review.rateDish")}
          </button>
        )}
      </div>

      {pending.length > 0 && !restaurantReviewed ? (
        <p className="mt-2 text-[11px] text-ink-400">
          {formatNumber(pending.length)} {t("unit.items")} — {t("review.prompt")}
        </p>
      ) : null}

      {sheet ? (
        <ReviewSheet
          token={token}
          kind={sheet.kind}
          menuItemId={sheet.menuItemId}
          title={sheet.kind === "item" ? t("review.itemTitle", { name: sheet.name ?? "" }) : t("review.restaurantTitle")}
          subtitle={sheet.kind === "item" ? t("review.howWasFood") : t("review.howWasVisit")}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}
