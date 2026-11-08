"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

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

  React.useEffect(() => {
    if (closed) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, 10000);
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
  }, [closed, router, token]);

  return null;
}
