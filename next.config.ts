import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const browserSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(), microphone=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: browserSecurityHeaders,
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default withWorkflow(nextConfig);
