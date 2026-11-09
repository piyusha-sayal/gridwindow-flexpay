import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lets a verification build go to its own directory so a running `next start` keeps serving the normal .next build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  async redirects() {
    // Old /benchmark links keep working; the page now lives at /impact-lab.
    return [{ source: "/benchmark", destination: "/impact-lab", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
