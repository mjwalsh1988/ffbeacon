import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "sleepercdn.com" },
      { protocol: "https", hostname: "cilvpyivysjxpxbudkfa.supabase.co" },
    ],
  },
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
