"use client";

import * as React from "react";
import { Clock3, TriangleAlert } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { formatMinutesShort, formatNumber } from "@/lib/format";
import { cx } from "@/components/ui";

/**
 * Live preparation estimate.
 *
 * The estimate is a promise about time; the order status is a fact about
 * cooking. This component only ever renders the difference between the two —
 * it can count a promise down and say it has been overrun, but it cannot mark
 * anything ready. When the ETA passes, the copy changes and nothing else does.
 */
export interface EtaSnapshot {
  minutes: number | null;
  startedAt: string | null;
  status: string;
}

const FINISHED = ["ready", "served", "rejected", "cancelled"];

export function EtaTimer({
  etaMinutes,
  startedAt,
  status,
  compact = false,
}: {
  etaMinutes: number | null;
  startedAt: string | null;
  status: string;
  compact?: boolean;
}) {
  const [now, setNow] = React.useState(() => Date.now());

  const finished = FINISHED.includes(status);
  const waiting = etaMinutes === null;

  React.useEffect(() => {
    if (finished || waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [finished, waiting]);

  if (waiting) {
    return (
      <div className={cx("rounded-xl border border-dashed border-ink-200 bg-ink-50/60 p-3", compact && "p-2.5")}>
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink-600">
          <Clock3 className="size-3.5" aria-hidden />
          Waiting for restaurant confirmation
        </p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-400">
          The kitchen will confirm a preparation time when they accept your order.
        </p>
      </div>
    );
  }

  const base = startedAt ? new Date(startedAt).getTime() : now;
  const t = useT();
  const dueAt = base + etaMinutes * 60_000;
  const remainingMs = dueAt - now;
  const overdue = !finished && remainingMs < 0;
  const elapsed = Math.max(0, now - base);
  const progress = Math.min(1, elapsed / (etaMinutes * 60_000));

  const minutesLeft = Math.max(0, Math.ceil(remainingMs / 60_000));
  const minutesOver = Math.max(0, Math.floor(-remainingMs / 60_000));

  return (
    <div
      className={cx(
        "rounded-xl border p-3",
        overdue ? "border-amber-300 bg-amber-50" : finished ? "border-moss-200 bg-moss-50/60" : "border-clay-200 bg-clay-50/60",
        compact && "p-2.5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">
            <Clock3 className="size-3" aria-hidden />
            {t("eta.estimate")}
          </p>
          <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-ink-900">
            {finished ? (
              etaMinutes === 0 ? "—" : formatMinutesShort(etaMinutes)
            ) : overdue ? (
              <span className="text-amber-900">{t("eta.overdue", { minutes: formatNumber(minutesOver) })}</span>
            ) : (
              <>{t("eta.remaining", { total: formatNumber(etaMinutes), remaining: formatNumber(minutesLeft) })}</>
            )}
          </p>
        </div>
        {overdue ? <TriangleAlert className="size-4 shrink-0 text-amber-600" aria-hidden /> : null}
      </div>

      {!finished ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
          <div
            className={cx("h-full rounded-full transition-[width] duration-1000", overdue ? "bg-amber-500" : "bg-clay-500")}
            style={{ width: `${Math.round(progress * 100)}%` }}
            aria-hidden
          />
        </div>
      ) : null}

      {overdue ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-amber-900">
          {t("eta.overdueHint")} ({t("eta.overdue", { minutes: formatNumber(minutesOver) })})
        </p>
      ) : finished ? (
        <p className="mt-1.5 text-[11.5px] text-ink-500">
          {status === "ready" ? t("eta.comingToTable") : t("eta.served")}
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] text-ink-400">
          {t("eta.waitingHint")}
        </p>
      )}
    </div>
  );
}
