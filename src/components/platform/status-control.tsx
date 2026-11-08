"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, cx } from "@/components/ui";

export function RestaurantStatusControl({
  restaurantId,
  status,
  isDemo,
}: {
  restaurantId: string;
  status: string;
  isDemo: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function setStatus(next: "active" | "suspended") {
    if (next === "suspended" && !window.confirm("Suspend this restaurant? Guest QR ordering stops immediately.")) return;
    setPending(next);
    setError(null);
    try {
      const res = await fetch("/api/platform/restaurants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ restaurantId, status: next }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) setError(data.error ?? "Could not update the account.");
      else router.refresh();
    } catch {
      setError("Network problem — nothing was changed.");
    } finally {
      setPending(null);
    }
  }

  if (isDemo) {
    return <span className="text-[11.5px] text-ink-400">Protected demo tenant</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {status !== "active" ? (
          <Button size="sm" variant="secondary" loading={pending === "active"} disabled={pending !== null} onClick={() => void setStatus("active")}>
            Activate
          </Button>
        ) : null}
        {status !== "suspended" ? (
          <Button size="sm" variant="secondary" loading={pending === "suspended"} disabled={pending !== null} onClick={() => void setStatus("suspended")}>
            Suspend
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className={cx("max-w-[220px] text-right text-[11px] leading-snug text-red-600")} role="alert">{error}</p>
      ) : null}
    </div>
  );
}
