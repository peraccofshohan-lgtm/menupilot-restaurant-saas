"use client";

/**
 * Realtime subscription helper.
 *
 * Deliberately dependency-free: it talks to Supabase Realtime's Phoenix socket
 * protocol over WebSocket, so nothing from `@supabase/*` is bundled and the anon
 * key is the only public credential involved.
 *
 * Design rules:
 *   * The channel topic is chosen by the *server*. `<RealtimeBridge />` passes the
 *     topic it received from `/api/realtime/token`, and the signed token carries
 *     the matching `mp_topic` claim, so a client cannot listen in on another
 *     tenant by editing a prop.
 *   * Any failure (no socket support, refused subscription, expired token) calls
 *     `onFallback`, which turns polling back on. Realtime never becomes a single
 *     point of failure for order handling.
 */

export interface RealtimeConfig {
  url: string;
  token: string;
  topic: string;
}

type Handler = (event: "ticket" | "heartbeat" | "unknown") => void;

interface PhoenixMessage {
  topic?: string;
  event?: string;
  payload?: unknown;
  ref?: string;
}

const HEARTBEAT_MS = 25_000;
const RECONNECT_MS = 4_000;

export function subscribeToRestaurant(
  config: RealtimeConfig,
  onEvent: Handler,
  onStateChange: (state: "connecting" | "live" | "closed") => void,
): () => void {
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  let closedByCaller = false;
  let ref = 0;

  const wsUrl = `${config.url.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(
    config.token,
  )}&vsn=1.0.0`;

  const send = (message: Record<string, unknown>) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const connect = () => {
    if (closedByCaller) return;
    onStateChange("connecting");

    try {
      // Browsers cannot set headers on WebSocket; the token travels as `apikey`
      // and again in the join payload, which Supabase Realtime validates.
      socket = new WebSocket(wsUrl);
    } catch {
      onStateChange("closed");
      onFallback(onEvent);
      return;
    }

    socket.onopen = () => {
      send({
        topic: config.topic,
        event: "phx_join",
        payload: { config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: [] } },
        ref: String(++ref),
        join_ref: "1",
      });
      heartbeat = setInterval(() => {
        send({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++ref) });
      }, HEARTBEAT_MS);
      // The join reply confirms acceptance; treat the socket opening as "connecting"
      // until then so the UI does not promise live updates that were refused.
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let message: PhoenixMessage;
      try {
        message = JSON.parse(event.data) as PhoenixMessage;
      } catch {
        return;
      }
      if (message.event === "phx_reply" && message.topic === config.topic) {
        const status = (message.payload as { status?: string } | undefined)?.status;
        if (status === "ok") onStateChange("live");
        else {
          // Refused (bad claim, expired token): fall back to polling immediately.
          onStateChange("closed");
          onFallback(onEvent);
          close();
        }
        return;
      }
      // Any change on our own tenant topic means "re-read your authorized feed".
      if (message.event === "postgres_changes" || message.event === "broadcast") {
        onEvent("ticket");
      }
    };

    socket.onerror = () => {
      onStateChange("closed");
      onFallback(onEvent);
    };

    socket.onclose = () => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      socket = null;
      if (closedByCaller) return;
      onStateChange("closed");
      onFallback(onEvent);
      // Retry quietly; polling keeps the screen correct while we wait.
      reconnect = setTimeout(connect, RECONNECT_MS);
    };
  };

  const close = () => {
    closedByCaller = true;
    if (heartbeat) clearInterval(heartbeat);
    if (reconnect) clearTimeout(reconnect);
    if (socket) {
      send({ topic: config.topic, event: "phx_leave", payload: {}, ref: String(++ref) });
      socket.close();
    }
    socket = null;
  };

  connect();
  return close;
}

/** Placeholder so a failed socket can hand control back to the poller. */
let onFallback: (handler: Handler) => void = () => undefined;

export function setFallbackListener(fn: (handler: Handler) => void) {
  onFallback = fn;
}
