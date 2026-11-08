import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Baseline hardening for every response, on every host. Kept here rather than only
  // in vercel.json so `next start`, a container, or any other runtime gets them too.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "x-content-type-options", value: "nosniff" },
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
          { key: "permissions-policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // The tracker and dashboard are authenticated surfaces; never let a proxy cache them.
        source: "/api/:path*",
        headers: [{ key: "cache-control", value: "no-store" }],
      },
    ];
  },
  images: {
    // All media is served from MenuPilot's own storage layer, never remote hotlinks.
    remotePatterns: [],
  },
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },
  // Preview hosts proxy the dev server from a different origin. Without this, Next
  // rejects server-action requests on the preview URL. Production hosts are not
  // affected.
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "3000-iy3o2ppuae1bdqmfbblps.e2b.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export default nextConfig;
