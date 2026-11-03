import type { NextConfig } from "next";

// Security headers applied to every response. The Content-Security-Policy with a
// per-request nonce is set in src/proxy.ts; these are the static companions.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), geolocation=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Browser tests run their own server against the test database in a separate build dir.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  turbopack: {
    rules: {
      // Imported films become hashed files under /_next/static/media, like images: cached for
      // good, and reachable on every host because the access wall passes /_next/ (DR-044).
      "*.mp4": { type: "asset" },
      "*.webm": { type: "asset" },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The proxy (and its per-request CSP) skips /api. Route handlers return JSON, but an
        // unknown /api path still renders the HTML 404 page, so give those a deny-all policy.
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" }],
      },
      {
        // Private order access: never leak the URL fragment holder via referrer, never index.
        source: "/order-access",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        // The short private-link page for SMS (DR-049): the same protection.
        source: "/o",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        source: "/orders/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
