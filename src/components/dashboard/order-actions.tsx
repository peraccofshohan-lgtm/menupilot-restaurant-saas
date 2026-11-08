"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChefHat, CircleCheck, CircleSlash, Clock3, Truck, X } from "lucide-react";
import { Button, cx } from "@/components/ui";
import type { OrderStatus } from "@/lib/services/orders";
import type { TenantRole } from "@/lib/auth/server";

/**
 * Role-aware lifecycle controls.
 *
 * The button set is derived from the same transition table the database enforces;
 * hiding a button is a convenience, never the security boundary.
 */
const NEXT_STEP: Partial<Record<OrderStatus, { next: OrderStatus; label: string; icon: React.ComponentType<{ className?: string }> }>> = {
  pending: { next: "accepted", label: "Accept order", icon: Check },
  accepted: { next: "preparing", label: "Start preparing", icon: ChefHat },
  preparing: { next: "ready", label: "Mark ready", icon: CircleCheck },
  ready: { next: "served", label: "Mark served", icon: Truck },
};

const ALLOWED: Record<string, TenantRole[]> = {
  accepted: ["owner", "manager"],
  rejected: ["owner", "manager"],
  preparing: ["owner", "manager", "kitchen"],
  ready: ["owner", "manager", "kitchen"],
  served: ["owner", "manager", "kitchen", "waiter"],
  cancelled: ["owner", "manager"],
};

export function OrderActions({
  orderId,
  restaurantId,
  status,
  role,
  etaCurrent = null,
  size = "md",
  fullWidth = false,
}: {
  orderId: string;
  restaurantId: string;
  status: OrderStatus;
  role: TenantRole;
  /** The estimate already promised to the guest, if any. */
  etaCurrent?: number | null;
  size?: "sm" | "md";
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [showReject, setShowReject] = React.useState(false);
  const [showAccept, setShowAccept] = React.useState(false);
  const [etaMinutes, setEtaMinutes] = React.useState(20);
  const [editingEta, setEditingEta] = React.useState(false);

  async function updateEta(minutes: number) {
    setBusy("eta");
    setError(null);
    try {
      const res = await fetch("/api/orders/eta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, restaurantId, minutes }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) setError(data.error ?? "The estimate could not be changed.");
      else {
        setEditingEta(false);
        router.refresh();
      }
    } catch {
      setError("Network problem — the estimate was not changed.");
    } finally {
      setBusy(null);
    }
  }

  async function run(next: OrderStatus, rejectionReason?: string, eta?: number | null) {
    setBusy(next);
    setError(null);
    try {
      const res = await fetch("/api/orders/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, next, restaurantId, reason: rejectionReason, etaMinutes: eta ?? null }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) setError(data.error ?? "Could not update this order.");
      else {
        setShowReject(false);
        setShowAccept(false);
        setEditingEta(false);
        setReason("");
        router.refresh();
      }
    } catch {
      setError("Network problem — the order was not updated.");
    } finally {
      setBusy(null);
    }
  }

  const primary = NEXT_STEP[status];
  const canAdvance = primary && ALLOWED[primary.next]?.includes(role);
  const canReject = status === "pending" && ALLOWED.rejected?.includes(role);
  const canCancel = ["accepted", "preparing", "ready"].includes(status) && ALLOWED.cancelled?.includes(role);

  const canEditEta = ["accepted", "preparing"].includes(status) && ["owner", "manager", "kitchen"].includes(role);

  if (!canAdvance && !canReject && !canCancel && !canEditEta) {
    return (
      <p className={cx("text-[12px] text-ink-400", fullWidth && "text-center")}>
        {["served", "rejected", "cancelled"].includes(status)
          ? "This order is closed."
          : "Your role cannot change this order."}
      </p>
    );
  }

  return (
    <div className={cx("space-y-2", fullWidth && "w-full")}>
      {error ? (
        <p className="rounded-md bg-red-50 px-2.5 py-1.5 text-[11.5px] text-red-700 ring-1 ring-inset ring-red-200" role="alert">
          {error}
        </p>
      ) : null}

      <div className={cx("flex gap-2", fullWidth ? "w-full" : "flex-wrap")}>
        {canAdvance && primary ? (
          <Button
            size={size}
            onClick={() =>
              // Accepting is the moment the restaurant promises a time, so it is
              // a two-part decision: approve, and say how long.
              primary.next === "accepted" ? setShowAccept((open) => !open) : void run(primary.next)
            }
            loading={busy === primary.next}
            disabled={busy !== null}
            className={fullWidth ? "flex-1" : undefined}
          >
            {busy !== primary.next ? <primary.icon className="size-3.5" aria-hidden /> : null}
            {primary.label}
          </Button>
        ) : null}
        {canReject ? (
          <Button size={size} variant="secondary" onClick={() => setShowReject((open) => !open)} disabled={busy !== null}>
            <X className="size-3.5" aria-hidden /> Reject
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            size={size}
            variant="ghost"
            onClick={() => {
              if (window.confirm("Cancel this order? This cannot be undone.")) void run("cancelled");
            }}
            loading={busy === "cancelled"}
            disabled={busy !== null}
          >
            <CircleSlash className="size-3.5" aria-hidden /> Cancel
          </Button>
        ) : null}
      </div>

      {showAccept && status === "pending" ? (
        <div className="rounded-lg border border-clay-200 bg-clay-50/60 p-2.5">
          <p className="text-[11.5px] font-medium text-ink-700">Preparation time to tell the guest</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {[10, 15, 20, 25, 30, 45].map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => setEtaMinutes(minutes)}
                className={cx(
                  "rounded-md border px-2 py-1 text-[11.5px] font-medium tabular-nums",
                  etaMinutes === minutes
                    ? "border-clay-600 bg-clay-600 text-white"
                    : "border-ink-200 bg-white text-ink-700 hover:border-clay-300",
                )}
              >
                {minutes}m
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={240}
              value={etaMinutes}
              onChange={(event) => setEtaMinutes(Math.max(1, Math.min(240, Number(event.target.value) || 1)))}
              aria-label="Preparation time in minutes"
              className="w-16 rounded-md border border-ink-200 bg-white px-2 py-1 text-[11.5px] tabular-nums text-ink-800 focus:border-clay-500 focus:outline-none"
            />
          </div>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-500">
            The guest sees “{etaMinutes} minutes”. This is an estimate — the kitchen still decides when it is ready.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowAccept(false)}>Not yet</Button>
            <Button size="sm" onClick={() => void run("accepted", undefined, etaMinutes)} loading={busy === "accepted"}>
              Accept · {etaMinutes} min
            </Button>
          </div>
        </div>
      ) : null}

      {["accepted", "preparing"].includes(status) ? (
        <div>
          {editingEta ? (
            <div className="rounded-lg border border-ink-200 bg-ink-50 p-2.5">
              <label htmlFor={`eta-${orderId}`} className="text-[11.5px] font-medium text-ink-600">
                Tell the guest a new preparation time
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id={`eta-${orderId}`}
                  type="number"
                  min={1}
                  max={240}
                  value={etaMinutes}
                  onChange={(event) => setEtaMinutes(Math.max(1, Math.min(240, Number(event.target.value) || 1)))}
                  className="w-20 rounded-md border border-ink-200 bg-white px-2 py-1.5 text-[12px] tabular-nums text-ink-800 focus:border-clay-500 focus:outline-none"
                />
                <span className="text-[11.5px] text-ink-500">minutes from when cooking started</span>
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditingEta(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void updateEta(etaMinutes)} loading={busy === "eta"}>
                  Update estimate
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditingEta(true)} disabled={busy !== null}>
              <Clock3 className="size-3.5" aria-hidden /> {etaCurrent ? `Estimate ${etaCurrent} min` : "Set estimate"}
            </Button>
          )}
        </div>
      ) : null}

      {showReject ? (
        <div className="rounded-lg border border-ink-200 bg-ink-50 p-2.5">
          <label htmlFor={`reason-${orderId}`} className="text-[11.5px] font-medium text-ink-600">
            Reason (shown to the guest)
          </label>
          <input
            id={`reason-${orderId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Kitchen is closing, item sold out…"
            className="mt-1 w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-[12px] text-ink-800 focus:border-clay-500 focus:outline-none focus:ring-2 focus:ring-clay-500/25"
            maxLength={200}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>Keep it</Button>
            <Button size="sm" variant="danger" onClick={() => void run("rejected", reason)} loading={busy === "rejected"}>
              Reject order
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
