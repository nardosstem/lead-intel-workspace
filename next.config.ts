import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // CSV parsing enforces a 5 MB content limit; leave room for action
      // serialization overhead while retaining a bounded request size.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
