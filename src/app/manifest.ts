import type { MetadataRoute } from "next";

/**
 * Web app manifest, generated from the same Bengali strings as the UI.
 *
 * Served at /manifest.webmanifest by Next. Everything it points at is local —
 * icons, start_url, scope — because this app is installed from
 * http://<local-server-ip>:3000 on a restaurant's own Wi-Fi, not from a public
 * domain.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "মেনুপাইলট — রেস্টুরেন্ট ব্যবস্থাপনা",
    short_name: "মেনুপাইলট",
    description:
      "রেস্টুরেন্টের সম্পূর্ণ ব্যবস্থাপনা — টেবিলের QR, অর্ডার, রান্নাঘর, হিসাব। ইন্টারনেট ছাড়াই লোকাল নেটওয়ার্কে চলে।",
    lang: "bn-BD",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f7f6",
    theme_color: "#181814",
    categories: ["business", "food", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
