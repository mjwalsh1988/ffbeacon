import type { NextConfig } from "next";
import { securityHeadersForNextConfig } from "./lib/security-headers";

/**
 * Beacon Brief slugs that no longer resolve, all sent to the Brief index.
 *
 * Thirty-one of these were removed on 2026-07-30 as news with no fantasy
 * bearing (docs/beacon-brief/beacon-brief-removals-2026-07-30.md). The last one,
 * hunter-henry-patriots-extension, was archived without a merged survivor, so
 * there is no article to point it at either.
 *
 * laremy-tunsil-torn-triceps-commanders is deliberately absent: it has a real
 * replacement and gets its own entry in redirects() below.
 *
 * Nothing here should ever come back as a published slug. If one does, delete
 * its line: a redirect would shadow the article and the article would never be
 * reachable.
 */
const RETIRED_BRIEF_SLUGS = [
  // Deaths and illness of people with no active NFL role.
  "chris-johnson-als-diagnosis",
  "bills-legend-jim-kelly-stroke-reveal",
  "saints-lb-keith-mitchell-passes-away",
  "rams-legend-leroy-irvin-dies-68",
  "texans-co-founder-janice-mcnair-passes-away-89",
  "remembering-joe-delaney-42-years",
  "doug-martin-parents-wrongful-death-lawsuit-oakland",
  // Ceremonial honors and tributes.
  "adrian-peterson-vikings-ring-of-honor",
  "chris-johnson-titans-ring-of-honor-2026-season-opener",
  "commanders-tribute-john-riggins-schefter",
  "commanders-retire-john-riggins-44-jersey-week-9-rams",
  "eagles-lurie-stuart-scott-enspire-award-autism",
  "bills-oj-simpson-not-honored-new-highmark-stadium",
  // Uniforms and stadiums.
  "bengals-white-bengal-uniforms-snf-steelers-week-10",
  "chiefs-new-stadium-renderings-2031",
  // League business, ownership, finance, calendar.
  "packers-record-revenue-2025-financial-report-leadership-change",
  "seahawks-sale-vinod-khosla-9-billion-record",
  "2027-nfl-draft-washington-dc-dates",
  "super-bowl-lxii-date-february-13-2028-atlanta",
  "nfl-tmrw-sports-pro-flag-football-league-venue-renderings",
  // Broadcast and media careers.
  "chase-daniel-espn-multi-year-extension-sec-nation-nfl-studio",
  "tony-romo-arrested-owi-milwaukee",
  // Non-player staff with no scheme or usage change.
  "browns-hire-ryan-grigson-senior-football-advisor-chris-cooper-promoted",
  "jaguars-promote-waldron-farwell-title-designations",
  "cardinals-ryan-gold-suspended-indefinitely-gambling-policy",
  "nfl-suspends-cardinals-ryan-gold-gambling",
  "titans-scout-blaise-taylor-guilty-murder",
  "myron-rolle-nflpa-strategic-advisory-player-brain-health",
  "gerald-alexander-vikings-suspension",
  // Off-field personal items with no availability impact.
  "caleb-williams-iceman-trademark-refused",
  // Wrong sport: a basketball recruit.
  "marcus-spears-jr-commits-texas-reclassifies-2026",
  // Archived with no merged survivor, so there is nothing to redirect to.
  "hunter-henry-patriots-extension",
] as const;

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
  // THE SHARE-IMAGE FONTS HAVE TO BE TRACED EXPLICITLY.
  //
  // lib/og/assets.ts reads two Geist TTFs off disk at module load, because
  // satori cannot decode the woff2 files next/font ships. A runtime
  // `readFileSync` is invisible to Vercel's file tracer, which follows imports,
  // so without this the fonts exist in development and are missing in
  // production: every generated image would fall back to whatever face satori
  // finds, or fail outright. The beacon mark is read from public/, which is
  // deployed as static output, but it is listed too so one entry covers every
  // file that module opens.
  outputFileTracingIncludes: {
    "/api/og/**": ["./assets/og-fonts/**", "./public/img/ff-beacon-mark-96.png"],
  },
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
      // Signal Check became the trade calculator: same tool, the slug now
      // matches the label already shipping in the nav and footer, and it is
      // the head term readers search for. Two explicit entries rather than a
      // :path* catch-all, matching the trade-finder precedent above, so a
      // future child route under the old path is a deliberate decision rather
      // than a silent forward. Share links to a graded trade live in Discord
      // messages and group chats indefinitely; the second entry is what keeps
      // those working.
      {
        source: "/tools/signal-check",
        destination: "/tools/trade-calculator",
        permanent: true,
      },
      {
        source: "/tools/signal-check/v/:shareId",
        destination: "/tools/trade-calculator/v/:shareId",
        permanent: true,
      },
      // Beacon Breakdown became Who Should I Start: same start/sit tool, the
      // new slug carries the head search term ("who should i start") the
      // owner confirmed for it rather than a brand-only name. Next.js
      // preserves the query string on a redirect by default, so an old
      // ?a=&b= link lands on the new page where that alias still works. Kept
      // as a permanent 308 forever, like the trade-calculator entries above:
      // the Copy link button published this path and it is already sitting
      // in shared links.
      {
        source: "/tools/beacon-breakdown",
        destination: "/tools/who-should-i-start",
        permanent: true,
      },
      // The activity log stopped being a route of its own. It rendered the
      // same panel, from the same loader, that the league overview already
      // carries; the team filter the page added now lives on the panel, so the
      // page was a second URL for one filter. Kept as a permanent 308 forever
      // for the same reason as the trade-finder entry above: the Copy link
      // button published this path, and links to it are already sitting in
      // league chats.
      //
      // The destination is the overview itself rather than an anchor on it. A
      // fragment is a client-side concept: it is never sent to the server, so
      // Next cannot append one here, and pretending otherwise in a redirect
      // rule would just be a lie in a comment.
      {
        source: "/leagues/:league_id/activity",
        destination: "/leagues/:league_id",
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
      // (docs/beacon-brief/beacon-brief-removals-2026-07-30.md), which left the redirect
      // pointing at a deleted page. A permanent redirect to a 404 is worse for
      // both readers and crawlers than the 404 itself, so the pair came out with
      // the articles. Both slugs now land in RETIRED_BRIEF_SLUGS below, which
      // sends them to the Brief index rather than to a page that is not there.
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
      // The 2026-07-30 removal list, plus the two articles that were archived
      // without a survivor. Google Search Console was reporting all 33 as 404s.
      //
      // A reader arriving on one of these is not lost, they are early: the
      // Discord posts announcing every removed article were deliberately left
      // in place (see the removals doc), so those links are still live in a
      // chat somewhere and will be for years. Landing them on the Brief index
      // is a better answer than a dead end.
      //
      // What this is NOT is an attempt to keep the ranking. These articles were
      // deleted because they were not fantasy football, and Google is entitled
      // to treat a redirect to a section index as a soft 404 and drop the URL,
      // which is the correct outcome. The redirect is for the person, not the
      // crawler.
      ...RETIRED_BRIEF_SLUGS.map((slug) => ({
        source: `/brief/${slug}`,
        destination: "/brief",
        permanent: true,
      })),
      // The one retired slug with a real replacement. The Tunsil triceps
      // article was archived; the Commanders IR article covers the same injury
      // to the same player and is published, so this one goes to the article
      // rather than to the index.
      {
        source: "/brief/laremy-tunsil-torn-triceps-commanders",
        destination: "/brief/commanders-newton-tunsil-injured-reserve",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
