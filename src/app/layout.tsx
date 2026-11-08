import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "MenuPilot — Restaurant management, without the chaos",
    template: "%s · MenuPilot",
  },
  description:
    "MenuPilot is a multi-tenant restaurant platform: QR table ordering, kitchen display, live order approvals, staff roles and analytics in one place.",
  applicationName: "MenuPilot",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#181814",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-ink-50 text-ink-800 antialiased">{children}</body>
    </html>
  );
}
