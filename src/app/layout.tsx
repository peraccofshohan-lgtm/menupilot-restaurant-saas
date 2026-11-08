import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getTranslator } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";
import { bnDictionary } from "@/lib/i18n/messages/bn";
import { ServiceWorkerRegistrar } from "@/components/pwa/register-sw";

/**
 * Root layout.
 *
 * The whole document is rendered in the interface language (`lang="bn-BD"`), so
 * screen readers, hyphenation and the browser's font fallback all treat the text
 * as Bengali. The dictionary for the active locale is handed to a client provider
 * exactly once, which is what lets client components translate without shipping
 * every language in the bundle.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: {
      default: `${t("app.name")} — ${t("app.tagline")}`,
      template: `%s · ${t("app.name")}`,
    },
    description: t("app.description"),
    applicationName: t("app.name"),
    robots: { index: true, follow: true },
    // Local-network install: the manifest is served by Next from app/manifest.ts.
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: t("app.name"),
      statusBarStyle: "default",
    },
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#181814",
  // Bengali text at small sizes is denser than Latin; allow zoom for staff who
  // need it rather than locking the scale.
  maximumScale: 5,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const translator = await getTranslator();

  return (
    <html lang={translator.htmlLang} dir="ltr">
      <body className="min-h-dvh bg-ink-50 text-ink-800 antialiased">
        <LocaleProvider locale={translator.locale} dictionary={bnDictionary}>
          {children}
        </LocaleProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
