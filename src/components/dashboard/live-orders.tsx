"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Radio, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ORDER_STATUS_KEY, OrderStatusBadge, cx } from "@/components/ui";
import { formatMoney, formatNumber, timeAgo } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { localizedTableLabel } from "@/lib/i18n/content";
import type { OrderSummary } from "@/lib/services/orders";
import { useRealtimePulse } from "./realtime-bridge";

/**
 * Realtime incoming-order feed.
 *
 * Delivery is server-sent-events style polling with a short interval, which works
 * identically on every host (including serverless) without a websocket provider.
 * The feed is authorized server-side on every request; the client never decides
 * which restaurant it is looking at.
 */
export function LiveOrders({
  restaurantId,
  currency,
  timeZone,
  initialPending,
  compact = false,
  canApprove,
}: {
  restaurantId: string;
  currency: string;
  timeZone: string;
  initialPending: number;
  compact?: boolean;
  canApprove: boolean;
}) {
  const t = useT();
  const [orders, setOrders] = React.useState<OrderSummary[]>([]);
  const [pending, setPending] = React.useState(initialPending);
  const [status, setStatus] = React.useState<"connecting" | "live" | "offline">("connecting");
  const [lastSync, setLastSync] = React.useState<Date | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const knownIds = React.useRef<Set<string>>(new Set());
  const router = useRouter();

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/feed?restaurant=${restaurantId}&status=pending&limit=8`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setStatus(res.status === 401 ? "offline" : "offline");
        return;
      }
      const data = (await res.json()) as { orders: OrderSummary[]; pending: number };
      const fresh = data.orders.filter((order) => !knownIds.current.has(order.id));
      for (const order of data.orders) knownIds.current.add(order.id);

      setOrders(data.orders);
      setPending(data.pending);
      setStatus("live");
      setLastSync(new Date());
      setError(null);

      if (fresh.length > 0 && knownIds.current.size > fresh.length) {
        setAnnouncement(
          fresh.length === 1
            ? `New order ${fresh[0]!.order_number} from ${fresh[0]!.table_label ?? "the counter"}`
            : `${fresh.length} new orders arrived`,
        );
      }
    } catch {
      setStatus("offline");
    }
  }, [restaurantId]);

  // Realtime is an accelerator: when the socket is live the poll interval backs
  // off to a slow safety net, and the socket itself triggers `load()` on change.
  // When it is unavailable this returns "polling" and nothing changes.
  const transport = useRealtimePulse(restaurantId, () => void load());

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      if (cancelled) return;
      await load();
      if (!cancelled) {
        const visible = document.visibilityState === "visible";
        const delay = transport === "live" ? (visible ? 45000 : 60000) : visible ? 6000 : 20000;
        timer = setTimeout(tick, delay);
      }
    }
    void tick();

    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, transport]);

  async function decide(orderId: string, action: "accepted" | "rejected") {
    if (action === "rejected" && !window.confirm(t("orders.rejectConfirm"))) {
      return;
    }
    setBusyId(orderId);
    setError(null);
    try {
      const res = await fetch("/api/orders/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, next: action, restaurantId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? t("error.generic"));
      } else {
        setAnnouncement(action === "accepted" ? t("status.accepted") : t("status.rejected"));
        await load();
        router.refresh();
      }
    } catch {
      setError(t("error.network"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {t("orders.incoming")}
            {pending > 0 ? <Badge tone="amber">{formatNumber(pending)}</Badge> : null}
          </span>
        }
        description={
          status === "live"
            ? t("orders.liveSynced", { when: lastSync ? timeAgo(lastSync) : t("orders.justNow") })
            : status === "connecting"
              ? t("orders.connecting")
              : t("orders.reconnecting")
        }
        action={
          <div className="flex items-center gap-1.5">
            <span
              className={cx(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ring-inset",
                status === "live" ? "bg-moss-50 text-moss-700 ring-moss-100" : "bg-ink-100 text-ink-500 ring-ink-200",
              )}
            >
              <Radio className={cx("size-2.5", status === "live" && "animate-pulse")} aria-hidden />
              {status === "live" ? t("orders.live") : t("orders.offline")}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              className="grid size-7 place-items-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              aria-label={t("orders.refresh")}
            >
              <RefreshCw className="size-3.5" aria-hidden />
            </button>
          </div>
        }
      />
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <CardBody className="pt-0">
        {error ? (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700 ring-1 ring-inset ring-red-200" role="alert">
            {error}
          </p>
        ) : null}

        {orders.length === 0 ? (
          <EmptyState
            compact
            icon={<Bell className="size-4" aria-hidden />}
            title={status === "offline" ? t("orders.offlineTitle") : t("orders.emptyTitle")}
            description={
              status === "offline"
                ? t("orders.offlineHint")
                : t("orders.emptyHint")
            }
          />
        ) : (
          <ul className={cx("space-y-2", compact && "space-y-1.5")}>
            {orders.map((order) => (
              <li key={order.id} className="fade-in rounded-lg border border-ink-100 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/orders/${order.id}`} className="text-[13px] font-semibold text-ink-900 hover:text-clay-700">
                        {localizedTableLabel(order.table_label) || t("unit.counter")}
                      </Link>
                      <span className="text-[11.5px] text-ink-400">{order.order_number}</span>
                      <OrderStatusBadge status={order.status} label={t(ORDER_STATUS_KEY[order.status] ?? order.status)} />
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink-500">
                      {formatNumber(order.item_count)} {t("unit.items")}
                      {order.customer_name ? ` · ${order.customer_name}` : ""}
                      {order.note ? ` · “${order.note}”` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-semibold tabular-nums text-ink-900">{formatMoney(order.total, currency)}</p>
                    <p className="text-[10.5px] text-ink-400">{timeAgo(order.created_at)}</p>
                  </div>
                </div>
                {canApprove ? (
                  <div className="mt-2.5 flex gap-2">
                    <Button size="sm" onClick={() => void decide(order.id, "accepted")} loading={busyId === order.id} className="flex-1">
                      {t("action.acceptOrder")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void decide(order.id, "rejected")}
                      disabled={busyId === order.id}
                    >
                      {t("action.rejectOrder")}
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-[11.5px] text-ink-400">{t("orders.waitingApproval")}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
