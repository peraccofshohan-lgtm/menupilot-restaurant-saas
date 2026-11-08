"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useOrderRealtimePulse } from "@/components/dashboard/realtime-bridge";

/**
 * Keeps the status badge honest without a websocket: refresh the server component
 * on a modest interval while the tab is visible, and stop once the order closes.
 */
export function OrderTracker({ token, initialStatus }: { token: string; initialStatus: string }) {
  const router = useRouter();
  const [status, setStatus] = React.useState(initialStatus);

  React.useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  const closed = ["served", "rejected", "cancelled"].includes(status);

  // A guest who keeps the page open gets near-instant status changes when the
  // project supports realtime; otherwise the 10s refresh below is the guarantee.
  const transport = useOrderRealtimePulse(closed ? null : token, () => router.refresh());

  React.useEffect(() => {
    if (closed) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, transport === "live" ? 45000 : 10000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [closed, router, token, transport]);

  return null;
}
