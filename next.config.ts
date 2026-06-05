import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "sleepercdn.com" },
      { protocol: "https", hostname: "cilvpyivysjxpxbudkfa.supabase.co" },
    ],
  },
  // Forward the Supabase publishable key into the client bundle without
  // requiring a NEXT_PUBLIC_ prefix in .env.local. The publishable key is
  // SAFE to expose to the browser by design (it's Supabase's modern
  // equivalent of the anon key — protected at the database layer by RLS).
  // We deliberately do NOT forward SUPABASE_SECRET_KEY here; it must stay
  // server-side only.
  env: {
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  },
  typedRoutes: false,
  // The League Sync tool was renamed to League Pulse. Keep old shared links
  // and bookmarks working by redirecting the legacy path to the new one.
  async redirects() {
    return [
      {
        source: "/tools/league-sync",
        destination: "/tools/league-pulse",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
