import type { Metadata } from "next";
import { WifiOff, ChefHat, RefreshCw } from "lucide-react";
import { getTranslator } from "@/lib/i18n/server";

/**
 * Offline fallback.
 *
 * Served by the service worker when a navigation cannot reach the local server.
 * It must render with no JavaScript and no network at all, so it is a plain
 * server component with inline copy — no client state, no fetch.
 *
 * The wording is deliberately operational, not technical: the guest is told to
 * tell a member of staff, because that is the only action that helps them.
 */
export const metadata: Metadata = {
  title: "সার্ভারে সংযোগ নেই",
  robots: { index: false, follow: false },
};

export default async function OfflinePage() {
  const { t } = await getTranslator();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-clay-50 text-clay-600">
        <WifiOff className="size-7" aria-hidden />
      </span>

      <h1 className="mt-5 text-[19px] font-semibold text-ink-900">{t("offline.serverDown.title")}</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-600">{t("offline.serverDown.body")}</p>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-400">{t("offline.serverDown.hint")}</p>

      <div className="mt-6 w-full rounded-xl border border-ink-200 bg-white p-4 text-left">
        <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-800">
          <ChefHat className="size-4 text-clay-600" aria-hidden />
          কর্মচারীকে যা জানাবেন
        </p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
          &ldquo;আমার ফোনে মেনু খুলছে না — সার্ভারের সঙ্গে সংযোগ নেই।&rdquo;
        </p>
      </div>

      <a
        href="/"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-[13.5px] font-semibold text-white hover:bg-ink-800"
      >
        <RefreshCw className="size-4" aria-hidden />
        {t("offline.retry")}
      </a>

      <p className="mt-8 text-[11px] text-ink-300">মেনুপাইলট · লোকাল নেটওয়ার্ক</p>
    </main>
  );
}
