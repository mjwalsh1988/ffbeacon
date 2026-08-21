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
      // Trade Finder inside a league became Trade Ideas: the same suggestion
      // engine, plus a builder for a deal nobody suggested. Kept as a permanent
      // 308 in the routing layer so shared links, the Copy link button's older
      // output, and anything already pasted into a league chat keep working
      // without ever rendering the old path.
      {
        source: "/leagues/:league_id/trade-finder",
        destination: "/leagues/:league_id/trade-ideas",
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
      //
      // The Ryan Gold pair that used to sit here is gone. Both of its articles
      // were removed on 2026-07-30 as front-office news with no fantasy bearing
      // (docs/beacon-brief-removals-2026-07-30.md), which left the redirect
      // pointing at a deleted page. A permanent redirect to a 404 is worse for
      // both readers and crawlers than the 404 itself, so the pair came out with
      // the articles. The retired slug now 404s, which is the honest answer.
      {
        source: "/brief/jacoby-brissett-new-deal-cardinals-2026-starter",
        destination: "/brief/jacoby-brissett-cardinals-reworked-contract-2026",
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
        destination:
          "/brief/geno-smith-battery-investigation-closed-no-charges",
        permanent: true,
      },
      // The 2026-08 duplicate incident (migrations 0177 and 0178). Twenty-five
      // slugs retired into eleven articles.
      //
      // Same shape as the 0151 pairs above, at a different scale and from a
      // different cause. Migration 0169 set the never-merge floor at relevance
      // tier 3, which is the tier the classifier gives every post about a current
      // player, so merging stopped entirely: one Jonathan Taylor contract became
      // six articles, one Jalon Walker ACL became five. Migration 0177 replaced
      // that judgement call with a deterministic event key; 0178 merged what had
      // already published.
      //
      // The survivors were rewritten by hand for 0178 and carry every fact worth
      // keeping from the whole cluster, so each retired slug is a permanent move
      // rather than a deletion.
      {
        source: "/brief/jonathan-taylor-colts-extension-a38a2",
        destination: "/brief/jonathan-taylor-colts-extension",
        permanent: true,
      },
      {
        source: "/brief/jonathan-taylor-colts-extension-e6a73",
        destination: "/brief/jonathan-taylor-colts-extension",
        permanent: true,
      },
      {
        source: "/brief/jonathan-taylor-colts-extension-65193",
        destination: "/brief/jonathan-taylor-colts-extension",
        permanent: true,
      },
      {
        source: "/brief/jonathan-taylor-colts-extension-4219a",
        destination: "/brief/jonathan-taylor-colts-extension",
        permanent: true,
      },
      {
        source: "/brief/jonathan-taylor-alec-pierce-colts-extensions",
        destination: "/brief/jonathan-taylor-colts-extension",
        permanent: true,
      },
      {
        source: "/brief/jahmyr-gibbs-record-rb-contract-lions",
        destination: "/brief/jahmyr-gibbs-extension-lions",
        permanent: true,
      },
      {
        source: "/brief/jahmyr-gibbs-record-extension-lions",
        destination: "/brief/jahmyr-gibbs-extension-lions",
        permanent: true,
      },
      {
        source: "/brief/jahmyr-gibbs-record-rb-contract-lions-11d5c",
        destination: "/brief/jahmyr-gibbs-extension-lions",
        permanent: true,
      },
      {
        source: "/brief/jahmyr-gibbs-extension-lions-66e1d",
        destination: "/brief/jahmyr-gibbs-extension-lions",
        permanent: true,
      },
      {
        source: "/brief/jahmyr-gibbs-contract-extension",
        destination: "/brief/jahmyr-gibbs-extension-lions",
        permanent: true,
      },
      {
        source: "/brief/bijan-robinson-contract-extension",
        destination: "/brief/bijan-robinson-contract-extension-falcons",
        permanent: true,
      },
      {
        source: "/brief/bijan-robinson-deal-gibbs-taylor",
        destination: "/brief/gibbs-robinson-taylor-20m-rb-extensions",
        permanent: true,
      },
      {
        source: "/brief/jalon-walker-injury-falcons-camp",
        destination: "/brief/jalon-walker-acl-tear-falcons",
        permanent: true,
      },
      {
        source: "/brief/jalon-walker-acl-injury-falcons",
        destination: "/brief/jalon-walker-acl-tear-falcons",
        permanent: true,
      },
      {
        source: "/brief/jalon-walker-torn-acl",
        destination: "/brief/jalon-walker-acl-tear-falcons",
        permanent: true,
      },
      {
        source: "/brief/jalon-walker-acl-tear-2026",
        destination: "/brief/jalon-walker-acl-tear-falcons",
        permanent: true,
      },
      {
        source: "/brief/stefon-diggs-commanders-signing",
        destination: "/brief/stefon-diggs-signs-commanders",
        permanent: true,
      },
      {
        source: "/brief/stefon-diggs-washington-commanders",
        destination: "/brief/stefon-diggs-signs-commanders",
        permanent: true,
      },
      {
        source: "/brief/stefon-diggs-signs-commanders-a909f",
        destination: "/brief/stefon-diggs-signs-commanders",
        permanent: true,
      },
      {
        source: "/brief/darnell-wright-bears-extension-431cc",
        destination: "/brief/darnell-wright-bears-extension",
        permanent: true,
      },
      {
        source: "/brief/darnell-wright-extension-bears",
        destination: "/brief/darnell-wright-bears-extension",
        permanent: true,
      },
      {
        source: "/brief/ocyrus-torrence-extension-bills-53b1b",
        destination: "/brief/ocyrus-torrence-extension-bills",
        permanent: true,
      },
      {
        source: "/brief/zay-flowers-ravens-extension-3f586",
        destination: "/brief/zay-flowers-ravens-extension",
        permanent: true,
      },
      {
        source: "/brief/aaron-donald-rams-workout",
        destination: "/brief/aaron-donald-rams-workout-comeback",
        permanent: true,
      },
      {
        source: "/brief/peter-skoronski-extension-titans-c6e5c",
        destination: "/brief/peter-skoronski-extension-titans",
        permanent: true,
      },
      // The three pairs the 2026-08 cleanup left behind, merged by hand in
      // migration 0203. Same shape as the block above: the survivor carries every
      // fact from both articles, so each retired slug is a move, not a deletion.
      {
        source: "/brief/peter-skoronski-titans-extension",
        destination: "/brief/peter-skoronski-extension-titans",
        permanent: true,
      },
      {
        source: "/brief/jedrick-wills-first-team-lt-bears",
        destination: "/brief/jedrick-wills-first-team-lt-bears-camp",
        permanent: true,
      },
      // Ja'Kobi Lane's two URLs were also spelled wrong. The writer returned a
      // slug containing U+043E, the Cyrillic small letter o, which is drawn like a
      // Latin o and is not one, so the old slugify split the name in half at it.
      // lib/beacon-brief/slug.ts folds lookalikes now; these move the two URLs
      // that were already published. The Michael Thomas article is a separate
      // story and was renamed rather than merged.
      {
        source: "/brief/jak-bi-lane-ravens-training-camp",
        destination: "/brief/jakobi-lane-ravens-training-camp",
        permanent: true,
      },
      {
        source: "/brief/jakob-lane-ravens-training-camp",
        destination: "/brief/jakobi-lane-ravens-training-camp",
        permanent: true,
      },
      {
        source: "/brief/jak-bi-lane-michael-thomas-comparison-ravens",
        destination: "/brief/jakobi-lane-michael-thomas-comparison-ravens",
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
