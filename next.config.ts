import type { NextConfig } from "next";
import { securityHeadersForNextConfig } from "./lib/security-headers";

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
  // equivalent of the anon key, protected at the database layer by RLS).
  // We deliberately do NOT forward SUPABASE_SECRET_KEY here; it must stay
  // server-side only.
  env: {
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  },
  typedRoutes: false,
  // sharp is a native module used by the Signal image-upload routes
  // (/api/signal/media, /api/signal/post-image, /api/admin/signal/reaction-emoji).
  // Mark it external so Next traces and ships its native binary with the
  // serverless function instead of bundling it; a bundled native binding fails
  // to load on Vercel and crashes the function at import time with
  // FUNCTION_INVOCATION_FAILED before any handler code (or its try/catch) runs.
  serverExternalPackages: ["sharp"],
  // Global security response headers (FFB-SEC-005). Applied to every route.
  // CSP ships in Report-Only mode; see lib/security-headers.ts for the path to
  // enforcement. Vercel additionally injects HSTS on production domains.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeadersForNextConfig(),
      },
    ];
  },
  // The League Sync tool was renamed to League Pulse. Keep old shared links
  // and bookmarks working by redirecting the legacy path to the new one.
  async redirects() {
    return [
      {
        source: "/tools/league-sync",
        destination: "/tools/league-pulse",
        permanent: true,
      },
      // Signal profiles moved to the canonical root /{handle} (Phase 7). The
      // legacy /u/{handle} paths are kept forever as permanent redirects so old
      // shared links and OG cards keep working. These run in the routing layer
      // before any page render, so they emit a real permanent 3xx (308) rather
      // than the soft client-side redirect a streamed page component would
      // produce. The root route then handles casing canonicalization and
      // handle-history resolution. `:handle` matches a single segment, so the
      // board redirect below is matched independently.
      {
        source: "/u/:handle/rankings/:boardId",
        destination: "/:handle/rankings/:boardId",
        permanent: true,
      },
      {
        source: "/u/:handle",
        destination: "/:handle",
        permanent: true,
      },
      // Four sets of Beacon Brief duplicates were merged into one canonical
      // article each (migration 0151). Each pair covered the identical news
      // event and published seconds apart, because the follow-up matcher in
      // lib/beacon-brief/curate.ts cannot see a sibling article that has not
      // finished writing yet when both source posts arrive in one poll window.
      //
      // The merged article carries every fact from both, so the retired slug is
      // a permanent move rather than a deletion. These belong in the routing
      // layer for the same reason as the /u/:handle redirects above: they emit a
      // real permanent 3xx before any render. Note that `permanent: true` sends
      // 308, which Google treats the same as a 301.
      //
      // The retired rows are status 'archived', so they are already out of the
      // sitemap and the public feed. The redirect is what preserves any link
      // equity and any external link that already points at the old URL.
      {
        source: "/brief/jacoby-brissett-new-deal-cardinals-2026-starter",
        destination: "/brief/jacoby-brissett-cardinals-reworked-contract-2026",
        permanent: true,
      },
      {
        source: "/brief/nfl-suspends-cardinals-ryan-gold-gambling",
        destination:
          "/brief/cardinals-ryan-gold-suspended-indefinitely-gambling-policy",
        permanent: true,
      },
      {
        source:
          "/brief/kyle-shanahan-car-accident-chris-foerster-49ers-training-camp",
        destination:
          "/brief/kyle-shanahan-car-accident-limited-49ers-training-camp-2026",
        permanent: true,
      },
      {
        source: "/brief/geno-smith-case-inactive-no-charges",
        destination: "/brief/geno-smith-battery-investigation-closed-no-charges",
        permanent: true,
      },
      // Signal Scout's leaderboards moved off their own route and into a
      // sidebar on the game page itself, so the standalone page is gone. Old
      // bookmarks and any indexed links land on the game page, which now
      // hosts the same three boards. Same reasoning as the /u/:handle
      // redirects above: handled in the routing layer, so it emits a real 308
      // rather than a soft client-side redirect.
      {
        source: "/games/signal-scout/leaderboards",
        destination: "/games/signal-scout",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
