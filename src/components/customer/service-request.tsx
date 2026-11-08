"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellRing, CircleCheck, Droplets, ReceiptText, Sparkles, UtensilsCrossed } from "lucide-react";
import { cx } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

/**
 * Table service requests.
 *
 * One open request per kind per order — enforced by a partial unique index, not
 * by this component. So a guest tapping "Water" three times creates one row and
 * sees "our team is on the way" rather than three staff walking over.
 */

const OPTIONS = [
  { kind: "waiter", labelKey: "service.callWaiter", icon: BellRing },
  { kind: "water", labelKey: "service.water", icon: Droplets },
  { kind: "plate", labelKey: "service.plate", icon: UtensilsCrossed },
  { kind: "bill", labelKey: "service.bill", icon: ReceiptText },
  { kind: "other", labelKey: "service.other", icon: Sparkles },
] as const;

type Kind = (typeof OPTIONS)[number]["kind"];

export function ServiceRequest({
  token,
  existing,
}: {
  token: string;
  existing: { kind: string; status: string; created_at: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState<Kind | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [justSent, setJustSent] = React.useState<Kind | null>(null);

  const openKinds = new Set(existing.filter((r) => r.status === "pending" || r.status === "acknowledged").map((r) => r.kind));

  async function send(kind: Kind) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch("/api/service", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, kind }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? t("error.generic"));
        return;
      }
      setJustSent(kind);
      router.refresh();
    } catch {
      setError(t("error.network"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const open = openKinds.has(option.kind);
          const Icon = option.icon;
          return (
            <button
              key={option.kind}
              type="button"
              disabled={busy !== null || open}
              onClick={() => send(option.kind)}
              className={cx(
                "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[12.5px] font-medium transition",
                open
                  ? "border-moss-200 bg-moss-50 text-moss-800"
                  : "border-ink-200 bg-white text-ink-700 hover:border-clay-300 hover:bg-clay-50/50",
                busy === option.kind && "opacity-60",
                option.kind === "other" && "col-span-2",
              )}
            >
              {open ? <CircleCheck className="size-4 shrink-0 text-moss-600" aria-hidden /> : <Icon className="size-4 shrink-0 text-ink-400" aria-hidden />}
              <span className="min-w-0 truncate">
                {open ? `${t(option.labelKey)} · ${t("service.acknowledged")}` : busy === option.kind ? t("state.sending") : t(option.labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      {justSent && !error ? (
        <p className="mt-2 text-[11.5px] text-moss-700">{t("service.sent")}</p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
