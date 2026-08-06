import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // CSV parsing enforces a 5 MB content limit; leave room for action
      // serialization overhead while retaining a bounded request size.
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), geolocation=(), microphone=()",
      },
      ...(process.env.NODE_ENV === "production"
        ? [{
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          }]
        : []),
    ];

    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },
};

export default nextConfig;
