"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellRing, CircleCheck, Droplets, ReceiptText, Sparkles, UtensilsCrossed } from "lucide-react";
import { Button, EmptyState, cx } from "@/components/ui";
import type { ServiceRequestRow } from "@/lib/services/reviews";

const ICON = {
  waiter: BellRing,
  water: Droplets,
  plate: UtensilsCrossed,
  bill: ReceiptText,
  other: Sparkles,
} as const;

const LABEL = {
  waiter: "Call waiter",
  water: "Water",
  plate: "Extra plate",
  bill: "Bill",
  other: "Other",
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
        setError(data.error ?? "That request could not be updated.");
        router.refresh();
      }
    } catch {
      setError("Network problem — the request was not updated.");
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
          title="No requests in the last 12 hours"
          description="When a guest asks for a waiter, water, a plate or the bill, it appears here."
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
          <h2 className="text-[13px] font-semibold text-ink-900">Open</h2>
          <span className="text-[12px] tabular-nums text-ink-500">{open.length}</span>
        </div>
        {open.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink-200 py-8 text-center text-[12px] text-ink-400">
            Everything has been handled.
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
                        <p className="truncate text-[13.5px] font-semibold text-ink-900">{LABEL[row.kind] ?? row.kind}</p>
                        <p className="text-[11px] text-ink-400">
                          {row.table_label ?? "Table"}
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
                      {minutes}m
                    </span>
                  </div>

                  {row.body ? <p className="mt-2 text-[12px] leading-snug text-ink-600">{row.body}</p> : null}

                  <div className="mt-2.5 flex gap-1.5">
                    {row.status === "pending" ? (
                      <Button size="sm" variant="secondary" onClick={() => void setStatus(row.id, "acknowledged")} loading={busy === row.id} className="flex-1">
                        Acknowledge
                      </Button>
                    ) : (
                      <span className="flex flex-1 items-center gap-1 text-[11px] font-medium text-moss-700">
                        <CircleCheck className="size-3.5" aria-hidden /> On the way
                      </span>
                    )}
                    <Button size="sm" onClick={() => void setStatus(row.id, "completed")} loading={busy === row.id} className="flex-1">
                      Done
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
          <h2 className="mb-2 text-[13px] font-semibold text-ink-900">Recently handled</h2>
          <ul className="divide-y divide-ink-100 rounded-[var(--radius-card)] border border-ink-200 bg-white">
            {closed.slice(0, 12).map((row) => {
              const Icon = ICON[row.kind] ?? Sparkles;
              return (
                <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="size-3.5 shrink-0 text-ink-400" aria-hidden />
                    <span className="truncate text-[12px] text-ink-700">
                      {LABEL[row.kind] ?? row.kind} · {row.table_label ?? "Table"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-400">
                    {row.status === "completed" ? "Completed" : "Cancelled"} · {ageMinutes(row.created_at, now)}m ago
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
