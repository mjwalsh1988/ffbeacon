import type { Metadata } from "next";
import Link from "next/link";

const DISCORD_INVITE_URL = "https://discord.gg/TCznWkSR";
const PAGE_URL = "https://ffbeacon.com/join";

/**
 * Why this page renders instead of doing a server-side redirect():
 *
 * Social platforms (Discord, X, Slack, iMessage, etc.) unfurl links by
 * fetching the URL and reading its <meta> tags. If we returned a 3xx
 * redirect to discord.gg here, the crawler would either (a) refuse to
 * follow cross-origin redirects and produce no preview, or (b) follow and
 * show Discord's generic "Join my Discord Server" card — neither of which
 * reads as an FF Beacon invite when shared.
 *
 * Instead, this page serves a full HTML response with branded OG metadata
 * that crawlers can index, then redirects human visitors via:
 *   1. <meta http-equiv="refresh"> — works without JS, picked up by every
 *      browser, ignored by most social unfurlers (they read meta tags but
 *      don't navigate).
 *   2. An inline <script> calling location.replace() — fires before paint
 *      for JS-enabled clients so users see the Discord invite almost
 *      instantly.
 *   3. A visible "Open Discord invite" link — accessibility fallback for
 *      any client where both of the above fail (e.g. scripted readers,
 *      no-script browsing).
 */

export const metadata: Metadata = {
  title: "Join the FF Beacon Discord",
  description:
    "Join the FF Beacon community on Discord — fantasy football tools, rankings, and trade talk built for everyone.",
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "Join the FF Beacon Discord",
    description:
      "Fantasy football tools, rankings, and trade reactions — built for everyone, including screen readers.",
    url: PAGE_URL,
    siteName: "FF Beacon",
    type: "website",
    images: [
      {
        url: "/api/og/join",
        width: 1200,
        height: 630,
        alt: "Join the FF Beacon Discord community",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Join the FF Beacon Discord",
    description:
      "Fantasy football tools, rankings, and trade reactions — built for everyone, including screen readers.",
    images: ["/api/og/join"],
    site: "@ffbeacon",
    creator: "@ffbeacon",
  },
  // Discourage indexing — the canonical entry points are /about and the
  // social profiles. The /join URL is a share-friendly redirect, not a
  // page we want surfacing in organic search.
  robots: { index: false, follow: true },
};

export default function JoinDiscordPage() {
  return (
    <>
      {/* No-JS / crawler-skipped redirect. 0-second refresh = effectively
          instant for any client that honors it. */}
      <meta httpEquiv="refresh" content={`0; url=${DISCORD_INVITE_URL}`} />

      {/* Pre-paint JS redirect for the common case. dangerouslySetInnerHTML
          is fine here — no user input, no XSS surface. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{window.location.replace(${JSON.stringify(DISCORD_INVITE_URL)});}catch(e){}})();`,
        }}
      />

      <main
        id="main"
        className="flex min-h-[60vh] items-center justify-center px-4 py-16"
      >
        <div className="max-w-xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan">
            Discord Invite
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Redirecting you to the{" "}
            <span className="bg-gradient-to-br from-brand-purple to-brand-cyan bg-clip-text text-transparent">
              FF Beacon Discord
            </span>
            …
          </h1>
          <p className="mt-4 text-base leading-relaxed text-ink-muted">
            If your browser doesn&rsquo;t redirect automatically, open the
            invite below.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Link
              href={DISCORD_INVITE_URL}
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md bg-gradient-to-br from-brand-purple to-brand-cyan px-5 py-3 text-sm font-semibold text-bg shadow-sm transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Open Discord invite
            </Link>
            <p className="text-xs text-ink-subtle">
              <code className="font-mono">{DISCORD_INVITE_URL}</code>
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
