"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellRing, CircleCheck, Droplets, ReceiptText, Sparkles, UtensilsCrossed } from "lucide-react";
import { Button, EmptyState, cx } from "@/components/ui";
import type { ServiceRequestRow } from "@/lib/services/reviews";
import { formatDuration, formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { localizedTableLabel } from "@/lib/i18n/content";

const ICON = {
  waiter: BellRing,
  water: Droplets,
  plate: UtensilsCrossed,
  bill: ReceiptText,
  other: Sparkles,
} as const;

const LABEL_KEY = {
  waiter: "service.callWaiter",
  water: "service.water",
  plate: "service.plate",
  bill: "service.bill",
  other: "service.other",
} as const;

function ageMinutes(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

export function ServiceBoard({
  restaurantId,
  initial,
}: {
  restaurantId: string;
  initial: ServiceRequestRow[];
}) {
  const t = useT();
  const router = useRouter();
  const [rows, setRows] = React.useState(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => setRows(initial), [initial]);
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  // Poll rather than claim a socket we do not have. Ten seconds is fast enough
  // for a guest who has just pressed "call waiter".
  React.useEffect(() => {
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/service/board?restaurantId=${restaurantId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { requests: ServiceRequestRow[] };
        setRows(data.requests);
      } catch {
        /* keep the last good board */
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [restaurantId]);

  async function setStatus(id: string, status: "acknowledged" | "completed") {
    setBusy(id);
    setError(null);
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status } : row)));
    try {
      const res = await fetch("/api/service/board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: id, status, restaurantId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? t("error.generic"));
        router.refresh();
      }
    } catch {
      setError(t("error.network"));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const open = rows.filter((row) => row.status === "pending" || row.status === "acknowledged");
  const closed = rows.filter((row) => row.status === "completed" || row.status === "cancelled");

  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white py-16">
        <EmptyState
          icon={<BellRing className="size-5" aria-hidden />}
          title={t("serviceBoard.empty")}
          description={t("serviceBoard.emptyHint")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-ink-900">{t("serviceBoard.title")}</h2>
          <span className="text-[12px] tabular-nums text-ink-500">{formatNumber(open.length)}</span>
        </div>
        {open.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink-200 py-8 text-center text-[12px] text-ink-400">
            {t("serviceBoard.empty")}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((row) => {
              const Icon = ICON[row.kind] ?? Sparkles;
              const minutes = ageMinutes(row.created_at, now);
              const urgent = minutes >= 5 && row.status === "pending";
              return (
                <li
                  key={row.id}
                  className={cx(
                    "rounded-[var(--radius-card)] border border-t-4 bg-white p-3 shadow-[var(--shadow-card)]",
                    urgent ? "border-red-200 border-t-red-400" : "border-ink-200 border-t-clay-400",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-clay-50 text-clay-700">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-ink-900">{t(LABEL_KEY[row.kind] ?? "service.other")}</p>
                        <p className="text-[11px] text-ink-400">
                          {localizedTableLabel(row.table_label) || t("unit.table")}
                          {row.order_number ? ` · ${row.order_number}` : ""}
                        </p>
                      </div>
                    </div>
                    <span
                      className={cx(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums ring-1 ring-inset",
                        urgent ? "bg-red-50 text-red-700 ring-red-200" : "bg-ink-100 text-ink-600 ring-ink-200",
                      )}
                    >
                      {formatDuration(minutes)}
                    </span>
                  </div>

                  {row.body ? <p className="mt-2 text-[12px] leading-snug text-ink-600">{row.body}</p> : null}

                  <div className="mt-2.5 flex gap-1.5">
                    {row.status === "pending" ? (
                      <Button size="sm" variant="secondary" onClick={() => void setStatus(row.id, "acknowledged")} loading={busy === row.id} className="flex-1">
                        {t("serviceBoard.acknowledge")}
                      </Button>
                    ) : (
                      <span className="flex flex-1 items-center gap-1 text-[11px] font-medium text-moss-700">
                        <CircleCheck className="size-3.5" aria-hidden /> {t("serviceBoard.acknowledged")}
                      </span>
                    )}
                    <Button size="sm" onClick={() => void setStatus(row.id, "completed")} loading={busy === row.id} className="flex-1">
                      {t("serviceBoard.complete")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {closed.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold text-ink-900">{t("serviceBoard.completed")}</h2>
          <ul className="divide-y divide-ink-100 rounded-[var(--radius-card)] border border-ink-200 bg-white">
            {closed.slice(0, 12).map((row) => {
              const Icon = ICON[row.kind] ?? Sparkles;
              return (
                <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="size-3.5 shrink-0 text-ink-400" aria-hidden />
                    <span className="truncate text-[12px] text-ink-700">
                      {t(LABEL_KEY[row.kind] ?? "service.other")} · {localizedTableLabel(row.table_label) || t("unit.table")}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-400">
                    {row.status === "completed" ? t("serviceBoard.completed") : t("status.cancelled")} · {formatDuration(ageMinutes(row.created_at, now))}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
