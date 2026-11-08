"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChefHat, CircleCheck, CircleSlash, Truck, X } from "lucide-react";
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
  size = "md",
  fullWidth = false,
}: {
  orderId: string;
  restaurantId: string;
  status: OrderStatus;
  role: TenantRole;
  size?: "sm" | "md";
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [showReject, setShowReject] = React.useState(false);

  async function run(next: OrderStatus, rejectionReason?: string) {
    setBusy(next);
    setError(null);
    try {
      const res = await fetch("/api/orders/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, next, restaurantId, reason: rejectionReason }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) setError(data.error ?? "Could not update this order.");
      else {
        setShowReject(false);
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

  if (!canAdvance && !canReject && !canCancel) {
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
            onClick={() => void run(primary.next)}
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
