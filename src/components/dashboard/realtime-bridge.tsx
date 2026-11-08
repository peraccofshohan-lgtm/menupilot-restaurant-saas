"use client";

/**
 * Realtime bridge.
 *
 * Keeps the existing polling behaviour untouched and adds a fast path:
 *
 *   * On mount it asks `/api/realtime/token` for a tenant-scoped channel. The
 *     server decides the topic from the session, so this component cannot be
 *     tricked into listening to another restaurant's events.
 *   * While the socket is live, `pulse()` fires immediately when something changes
 *     and the polling interval backs off, so the screen feels instant without
 *     hammering the API.
 *   * When realtime is unavailable (no project, refused subscription, no secret)
 *     it does nothing at all and the existing poller keeps working.
 *
 * Nothing in the UI requires this component to succeed.
 */

import * as React from "react";

interface TokenResponse {
  configured: boolean;
  url?: string;
  anonKey?: string;
  token?: string;
  topic?: string;
  reason?: string;
}

export function useRealtimePulse(restaurantId: string | null, onChange: () => void): "live" | "polling" {
  const [state, setState] = React.useState<"live" | "polling">("polling");
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  React.useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const res = await fetch(`/api/realtime/token?restaurant=${encodeURIComponent(restaurantId)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as TokenResponse;
        if (cancelled || !data.configured || !data.url || !data.token || !data.topic) return;

        // Imported lazily so the socket code never runs on the server.
        const { subscribeToRestaurant } = await import("@/lib/realtime/client");
        if (cancelled) return;

        cleanup = subscribeToRestaurant(
          { url: data.url, token: data.token, topic: data.topic },
          () => onChangeRef.current(),
          (next) => setState(next === "live" ? "live" : "polling"),
        );
      } catch {
        // Realtime is optional: polling already covers correctness.
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
      setState("polling");
    };
  }, [restaurantId]);

  return state;
}

/**
 * Guest-side realtime: watches exactly one order.
 *
 * The topic is derived and signed by the server from the tracking token, so this
 * component cannot point the socket at someone else's ticket.
 */
export function useOrderRealtimePulse(trackingToken: string | null, onChange: () => void): "live" | "polling" {
  const [state, setState] = React.useState<"live" | "polling">("polling");
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  React.useEffect(() => {
    if (!trackingToken) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const res = await fetch(`/api/realtime/order?token=${encodeURIComponent(trackingToken)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as TokenResponse;
        if (cancelled || !data.configured || !data.url || !data.token || !data.topic) return;
        const { subscribeToRestaurant } = await import("@/lib/realtime/client");
        if (cancelled) return;
        cleanup = subscribeToRestaurant(
          { url: data.url, token: data.token, topic: data.topic },
          () => onChangeRef.current(),
          (next) => setState(next === "live" ? "live" : "polling"),
        );
      } catch {
        // Polling already covers correctness.
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
      setState("polling");
    };
  }, [trackingToken]);

  return state;
}
