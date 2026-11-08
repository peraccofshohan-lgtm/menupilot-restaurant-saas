"use client";

import * as React from "react";
import { BellRing, ChefHat, CircleCheck, Clock3, Maximize2, Minimize2, RefreshCw, WifiOff } from "lucide-react";
import { Badge, Button, EmptyState, cx } from "@/components/ui";
import type { KitchenTicket } from "@/lib/services/orders";
import type { TenantRole } from "@/lib/auth/server";
import { useRealtimePulse } from "@/components/dashboard/realtime-bridge";

/**
 * Kitchen Display System.
 *
 * Optimised for a wall-mounted tablet: large type, three columns by state, no
 * navigation chrome, and an audio cue when a new ticket arrives. It polls its own
 * authorized feed so it keeps working after a laptop sleeps or a Wi-Fi blip.
 */
type Column = { key: "accepted" | "preparing" | "ready"; title: string; hint: string; accent: string };

const COLUMNS: Column[] = [
  { key: "accepted", title: "To start", hint: "Approved, waiting for a cook", accent: "border-t-sky-400" },
  { key: "preparing", title: "On the pass", hint: "Being cooked right now", accent: "border-t-clay-400" },
  { key: "ready", title: "Ready", hint: "Waiting for a runner", accent: "border-t-violet-400" },
];

export function KitchenBoard({
  restaurantId,
  restaurantName,
  role,
  initialTickets,
}: {
  restaurantId: string;
  restaurantName: string;
  role: TenantRole;
  initialTickets: KitchenTicket[];
}) {
  const [tickets, setTickets] = React.useState<KitchenTicket[]>(initialTickets);
  const [status, setStatus] = React.useState<"live" | "offline" | "connecting">("live");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const known = React.useRef<Set<string>>(new Set(initialTickets.map((ticket) => ticket.id)));
  const audioReady = React.useRef(false);

  // Age labels need a ticking clock, not a fixed render timestamp.
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/kitchen/feed?restaurant=${restaurantId}`, { cache: "no-store" });
      if (!res.ok) {
        setStatus("offline");
        return;
      }
      const data = (await res.json()) as { tickets: KitchenTicket[] };
      const fresh = data.tickets.filter((ticket) => !known.current.has(ticket.id));
      data.tickets.forEach((ticket) => known.current.add(ticket.id));
      setTickets(data.tickets);
      setStatus("live");
      if (fresh.length > 0 && audioReady.current) chime();
    } catch {
      setStatus("offline");
    }
  }, [restaurantId]);

  // Kitchen display: same contract as the owner feed. A live socket triggers an
  // immediate refresh; polling remains the correctness guarantee underneath.
  const transport = useRealtimePulse(restaurantId, () => void refresh());

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (cancelled) return;
      await refresh();
      if (!cancelled) {
        const visible = document.visibilityState === "visible";
        timer = setTimeout(tick, transport === "live" ? (visible ? 30000 : 60000) : visible ? 7000 : 25000);
      }
    }
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh, transport]);

  // Browsers only allow audio after a gesture; arm it on the first interaction.
  React.useEffect(() => {
    const arm = () => {
      audioReady.current = true;
    };
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);

  function chime() {
    try {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      /* audio is a nicety, never a requirement */
    }
  }

  async function advance(ticket: KitchenTicket, next: "preparing" | "ready" | "served") {
    setBusy(ticket.id);
    setError(null);
    try {
      const res = await fetch("/api/orders/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: ticket.id, next, restaurantId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) setError(data.error ?? "That ticket could not be updated.");
      else await refresh();
    } catch {
      setError("Network problem — the ticket was not updated.");
      setStatus("offline");
    } finally {
      setBusy(null);
    }
  }

  const grouped = COLUMNS.map((column) => ({
    ...column,
    items: tickets
      .filter((ticket) => ticket.status === column.key)
      .sort((a, b) => new Date(a.accepted_at).getTime() - new Date(b.accepted_at).getTime()),
  }));

  const total = tickets.length;

  return (
    <div className={cx(fullscreen && "fixed inset-0 z-50 overflow-auto bg-ink-50 p-4")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="text-[13.5px] font-semibold text-ink-900">{restaurantName}</span>
          <span
            className={cx(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ring-inset",
              status === "live" ? "bg-moss-50 text-moss-700 ring-moss-100" : "bg-amber-50 text-amber-700 ring-amber-200",
            )}
          >
            {status === "live" ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : <WifiOff className="size-2.5" aria-hidden />}
            {status === "live" ? "Live" : "Reconnecting"}
          </span>
          <Badge tone="neutral">{total} active ticket{total === 1 ? "" : "s"}</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void refresh()} aria-label="Refresh tickets">
            <RefreshCw className="size-3.5" aria-hidden /> Refresh
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setFullscreen((value) => !value)}>
            {fullscreen ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />}
            {fullscreen ? "Exit" : "Full screen"}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700 ring-1 ring-inset ring-red-200" role="alert">
          {error}
        </p>
      ) : null}

      {total === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white py-20">
          <EmptyState
            icon={<BellRing className="size-5" aria-hidden />}
            title="The pass is clear"
            description="Approved orders appear here instantly, oldest first. Keep this screen open on any tablet in the kitchen."
          />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          {grouped.map((column) => (
            <section key={column.key} aria-label={column.title} className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-[13.5px] font-semibold text-ink-900">{column.title}</h2>
                  <p className="text-[11px] text-ink-400">{column.hint}</p>
                </div>
                <span className="text-[12px] font-semibold tabular-nums text-ink-500">{column.items.length}</span>
              </div>
              <ul className="space-y-2">
                {column.items.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-ink-200 py-8 text-center text-[12px] text-ink-400">
                    Nothing here
                  </li>
                ) : null}
                {column.items.map((ticket) => {
                  const minutes = Math.max(0, Math.floor((now - new Date(ticket.accepted_at).getTime()) / 60000));
                  const urgent = minutes >= 15 && ticket.status !== "ready";
                  return (
                    <li
                      key={ticket.id}
                      className={cx(
                        "fade-in rounded-[var(--radius-card)] border border-t-4 border-ink-200 bg-white shadow-[var(--shadow-card)]",
                        column.accent,
                      )}
                    >
                      <div className="flex items-start justify-between gap-2 border-b border-ink-100 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold text-ink-900">{ticket.table_label ?? "Counter"}</p>
                          <p className="text-[10.5px] text-ink-400">{ticket.order_number}</p>
                        </div>
                        <span
                          className={cx(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums ring-1 ring-inset",
                            urgent ? "bg-red-50 text-red-700 ring-red-200" : "bg-ink-100 text-ink-600 ring-ink-200",
                          )}
                        >
                          <Clock3 className="size-2.5" aria-hidden /> {minutes}m
                        </span>
                      </div>

                      <ul className="space-y-1 px-3 py-2">
                        {ticket.items.map((line) => (
                          <li key={line.id} className="flex items-start gap-2">
                            <span className="mt-px inline-flex min-w-6 justify-center rounded bg-ink-100 px-1 py-0.5 text-[12px] font-bold tabular-nums text-ink-700">
                              {line.quantity}
                            </span>
                            <div className="min-w-0">
                              <p className="text-[13.5px] font-medium leading-snug text-ink-800">{line.name}</p>
                              {line.note ? <p className="text-[11.5px] font-medium leading-snug text-clay-700">↳ {line.note}</p> : null}
                            </div>
                          </li>
                        ))}
                      </ul>

                      {ticket.note ? (
                        <p className="mx-3 mb-2 rounded-md bg-amber-50 px-2 py-1 text-[11.5px] leading-snug text-amber-900 ring-1 ring-inset ring-amber-200">
                          Note: {ticket.note}
                        </p>
                      ) : null}

                      <div className="border-t border-ink-100 p-2">
                        {ticket.status === "accepted" ? (
                          <Button
                            size="md"
                            fullWidth
                            onClick={() => void advance(ticket, "preparing")}
                            loading={busy === ticket.id}
                            disabled={busy !== null}
                          >
                            <ChefHat className="size-4" aria-hidden /> Start preparing
                          </Button>
                        ) : null}
                        {ticket.status === "preparing" ? (
                          <Button
                            size="md"
                            fullWidth
                            onClick={() => void advance(ticket, "ready")}
                            loading={busy === ticket.id}
                            disabled={busy !== null}
                          >
                            <CircleCheck className="size-4" aria-hidden /> Mark ready
                          </Button>
                        ) : null}
                        {ticket.status === "ready" ? (
                          <Button
                            size="md"
                            fullWidth
                            variant="secondary"
                            onClick={() => void advance(ticket, "served")}
                            loading={busy === ticket.id}
                            disabled={busy !== null}
                          >
                            Mark served
                          </Button>
                        ) : null}
                        {role === "waiter" && ticket.status !== "ready" ? (
                          <p className="mt-1.5 text-center text-[10.5px] text-ink-400">Waiters can serve ready tickets.</p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
