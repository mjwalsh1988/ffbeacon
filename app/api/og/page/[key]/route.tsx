import { ImageResponse } from "next/og";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;

// FF Beacon brand colors (CLAUDE.md). No DPC gold/violet, no #0c0c18.
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#8A8A9C";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const LINE = "#1F1F33";

type PageCard = {
  /** Small uppercase line above the headline. Says what kind of thing this is. */
  eyebrow: string;
  /** First headline line, in plain ink. */
  headlineTop: string;
  /** Second headline line, in the beacon gradient. */
  headlineBottom: string;
  /** The sentence under it: what you get, in the words a reader would use. */
  subhead: string;
  /** Up to three short pills. Reasons to click, not features. */
  facts: string[];
  /** The path printed bottom-left, without the domain. */
  path: string;
  /** Short label pinned bottom-right. */
  badge: string;
};

/**
 * Social cards for the pages whose content does not change per visitor: the
 * homepage, the tools, the games, and the section indexes.
 *
 * Every one of these used to share as either nothing at all or the square site
 * logo, which tells a reader who has never heard of us precisely nothing about
 * what they are being sent. Each card here names the thing and gives a reason
 * to open it.
 *
 * One entry per key. A key with no row returns 404 rather than rendering a
 * blank branded rectangle, so a typo in a page's metadata shows up as a missing
 * image instead of an empty card shared to X. Same contract as the guide cards
 * in app/api/og/guide/[slug]/route.tsx.
 *
 * Copy rules for anything added here: say what the reader gets, not what the
 * feature is called. No jargon a new manager would have to look up, and no
 * counts that go stale the moment a tool is added.
 */
const PAGE_CARDS: Record<string, PageCard> = {
  home: {
    eyebrow: "Fantasy football, made readable",
    headlineTop: "Your signal through",
    headlineBottom: "the fantasy noise",
    subhead:
      "Rankings, trade grades, draft help, and league tools, free to use and built to work by ear as well as by eye.",
    facts: ["Free to use", "No signup", "Screen reader ready"],
    path: "/",
    badge: "Start here",
  },
  about: {
    eyebrow: "About FF Beacon",
    headlineTop: "Built so everyone",
    headlineBottom: "can actually use it",
    subhead:
      "A fantasy football site where the screen reader is not an afterthought. Every number on the page is a number you can hear.",
    facts: ["Accessibility first", "Free", "Independent"],
    path: "/about",
    badge: "Our story",
  },
  author: {
    eyebrow: "The person behind it",
    headlineTop: "Michael, who built",
    headlineBottom: "FF Beacon",
    subhead:
      "One manager who got tired of fantasy tools he could not read, and built the ones he wanted instead.",
    facts: ["Founder", "Writes the Brief"],
    path: "/author/michael",
    badge: "Meet the founder",
  },
  tools: {
    eyebrow: "Free fantasy football tools",
    headlineTop: "Tools for the whole",
    headlineBottom: "fantasy season",
    subhead:
      "Sync your Sleeper leagues, get help live in the draft, grade a trade, compare two players, and know what to bid on waivers.",
    facts: ["Free", "No signup", "Redraft and dynasty"],
    path: "/tools",
    badge: "All tools",
  },
  "signal-check": {
    eyebrow: "Trade grader",
    headlineTop: "Is this trade",
    headlineBottom: "actually fair?",
    subhead:
      "Put both sides in and get a straight answer: who wins, by how much, and the reason why. Redraft or dynasty, players or picks.",
    facts: ["Free", "No signup", "Shareable result"],
    path: "/tools/signal-check",
    badge: "Signal Check",
  },
  "league-pulse": {
    eyebrow: "Sleeper league tool",
    headlineTop: "Every league you own,",
    headlineBottom: "on one page",
    subhead:
      "Type your Sleeper name and see every roster, every trade, and who is really winning. No login needed to look.",
    facts: ["Just your username", "Live from Sleeper"],
    path: "/tools/league-pulse",
    badge: "League Pulse",
  },
  "on-the-clock": {
    eyebrow: "Live draft helper",
    headlineTop: "Never miss the best",
    headlineBottom: "player left",
    subhead:
      "Follows your Sleeper draft as it happens, clears out everyone already gone, and tells you who is worth the pick.",
    facts: ["Live from Sleeper", "Free", "Works on your phone"],
    path: "/tools/on-the-clock",
    badge: "On The Clock",
  },
  faab: {
    eyebrow: "Waiver bid calculator",
    headlineTop: "How much to bid,",
    headlineBottom: "and when to stop",
    subhead:
      "Priced against your own roster, what your rivals can still spend, and what your league has actually been paying all season.",
    facts: ["Free", "No signup", "Your league's numbers"],
    path: "/tools/faab",
    badge: "FAAB Calculator",
  },
  "beacon-breakdown": {
    eyebrow: "Player comparison",
    headlineTop: "Two players,",
    headlineBottom: "one clear answer",
    subhead:
      "Side by side on value, points, and role, then scored under your own league's rules if you want it that specific.",
    facts: ["Free", "No signup", "Any two players"],
    path: "/tools/beacon-breakdown",
    badge: "Beacon Breakdown",
  },
  games: {
    eyebrow: "Fantasy football games",
    headlineTop: "Play something",
    headlineBottom: "with real players",
    subhead:
      "Free games built on live NFL data, so what you learn playing them is worth something on Sunday.",
    facts: ["Free to play", "No signup"],
    path: "/games",
    badge: "All games",
  },
  "signal-scout": {
    eyebrow: "Daily guessing game",
    headlineTop: "Decode the profile.",
    headlineBottom: "Find the player.",
    subhead:
      "Clues cost you points, and buying too many burns your signal out. How few does it take you to name the hidden player?",
    facts: ["New round daily", "Free to play", "Streaks"],
    path: "/games/signal-scout",
    badge: "Signal Scout",
  },
  rankings: {
    eyebrow: "Player rankings",
    headlineTop: "Who is actually",
    headlineBottom: "worth what",
    subhead:
      "Every player ranked for your scoring, with the seven-day move beside each one so you can see who is climbing.",
    facts: ["Updated daily", "Redraft and dynasty", "Superflex"],
    path: "/rankings",
    badge: "Rankings",
  },
  brief: {
    eyebrow: "The Beacon Brief",
    headlineTop: "The news that",
    headlineBottom: "changes your lineup",
    subhead:
      "Injuries, snap counts, trades, and depth chart moves, written plainly and tied to the players you actually roster.",
    facts: ["Updated all day", "Free to read"],
    path: "/brief",
    badge: "The Beacon Brief",
  },
  guides: {
    eyebrow: "Fantasy football guides",
    headlineTop: "Plain English,",
    headlineBottom: "no assumed knowledge",
    subhead:
      "What the words actually mean and how to use them. Start with the glossary, then take the draft guide into your next draft.",
    facts: ["Free to read", "No jargon"],
    path: "/guides",
    badge: "Guides",
  },
};

/**
 * GET /api/og/page/[key]
 *
 * 1200x630 Open Graph and Twitter card for one of the site's fixed pages.
 * Static per key, so it caches hard at the edge and costs no database read.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const card = PAGE_CARDS[key];
  if (!card) {
    return new Response("Not found", { status: 404 });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE.width,
          height: SIZE.height,
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(135deg, ${BG_BASE} 0%, ${BG} 60%, ${BG_BASE} 100%)`,
          color: INK,
          padding: 64,
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          position: "relative",
        }}
      >
        {/* Beacon gradient accent along the top edge. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: 6,
            background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
          }}
        />
        {/* Corner glows, the same two the site paints behind its own panels. */}
        <div
          style={{
            position: "absolute",
            top: -140,
            left: -140,
            width: 520,
            height: 520,
            borderRadius: 260,
            background: "radial-gradient(circle, rgba(168,85,247,0.20) 0%, rgba(168,85,247,0) 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -120,
            right: -160,
            width: 480,
            height: 480,
            borderRadius: 240,
            background: "radial-gradient(circle, rgba(34,211,238,0.16) 0%, rgba(34,211,238,0) 70%)",
          }}
        />

        {/* Brand wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 34 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            }}
          />
          <p style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5, margin: 0 }}>
            FF Beacon
          </p>
        </div>

        <p
          style={{
            fontSize: 20,
            color: CYAN,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: 4,
            fontWeight: 600,
          }}
        >
          {card.eyebrow}
        </p>

        <h1
          style={{
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: -2,
            margin: "16px 0 4px 0",
            lineHeight: 1.04,
          }}
        >
          {card.headlineTop}
        </h1>
        <h1
          style={{
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: -2,
            margin: 0,
            lineHeight: 1.04,
            background: `linear-gradient(90deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            backgroundClip: "text",
            color: "transparent",
            display: "flex",
          }}
        >
          {card.headlineBottom}
        </h1>

        <p
          style={{
            fontSize: 25,
            color: INK_MUTED,
            margin: "24px 0 0 0",
            lineHeight: 1.4,
            maxWidth: 950,
          }}
        >
          {card.subhead}
        </p>

        {/* Reasons to click, as pills. */}
        <div style={{ display: "flex", gap: 12, marginTop: 26 }}>
          {card.facts.slice(0, 3).map((fact) => (
            <div
              key={fact}
              style={{
                display: "flex",
                alignItems: "center",
                border: `1px solid ${LINE}`,
                borderRadius: 999,
                padding: "8px 18px",
                fontSize: 21,
                color: INK_MUTED,
                background: "rgba(15,15,26,0.7)",
              }}
            >
              {fact}
            </div>
          ))}
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 52,
            left: 64,
            right: 64,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `1px solid ${LINE}`,
            paddingTop: 20,
          }}
        >
          <p style={{ fontSize: 22, color: INK_SUBTLE, margin: 0, letterSpacing: 1 }}>
            ffbeacon.com{card.path === "/" ? "" : card.path}
          </p>
          <p style={{ fontSize: 22, color: INK_SUBTLE, margin: 0, letterSpacing: 1 }}>
            {card.badge}
          </p>
        </div>
      </div>
    ),
    {
      ...SIZE,
      headers: {
        "Cache-Control":
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
