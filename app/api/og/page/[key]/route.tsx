import { renderHeadlineCard } from "@/lib/og/headline-card";

export const runtime = "nodejs";

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
    eyebrow: "Fantasy football trade calculator",
    headlineTop: "Is this trade",
    headlineBottom: "actually fair?",
    subhead:
      "Put both sides in and get a straight answer: who wins, by how much, and the reason why. Redraft or dynasty, players or picks.",
    facts: ["Free", "No signup", "Shareable result"],
    path: "/tools/trade-calculator",
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
    eyebrow: "Fantasy football FAAB calculator",
    headlineTop: "How much to bid,",
    headlineBottom: "and when to stop",
    subhead:
      "Priced against your own roster, what your rivals can still spend, and what your league has actually been paying all season.",
    facts: ["Free", "No signup", "Your league's numbers"],
    path: "/tools/faab",
    badge: "FAAB Calculator",
  },
  "waiver-wire": {
    eyebrow: "Fantasy football waiver wire",
    headlineTop: "Who to add,",
    headlineBottom: "and what to bid",
    subhead:
      "Every week: who is actually still free, whose role just changed, and a bid range from the same engine our FAAB calculator runs.",
    facts: ["Free", "No signup", "Measured, not guessed"],
    path: "/waiver-wire",
    badge: "Waiver Wire",
  },
  season: {
    eyebrow: "Fantasy football stats this season",
    headlineTop: "The whole season,",
    headlineBottom: "one page",
    subhead:
      "Who is scoring, where every player ranks at his position, last week's results, and this week's games with the forecast for each.",
    facts: ["Free", "No signup", "Updated every morning"],
    path: "/season",
    badge: "Season Pulse",
  },
  "season-leaders": {
    eyebrow: "Fantasy football leaders",
    headlineTop: "Where does he rank",
    headlineBottom: "at his position?",
    subhead:
      "Every player's fantasy points this season, his rank at his position, and how each week went. Type a name to find him.",
    facts: ["PPR, half PPR and standard", "Week by week", "Free"],
    path: "/season/leaders",
    badge: "Season Pulse",
  },
  "season-stats": {
    eyebrow: "NFL stat leaders",
    headlineTop: "Yards, touchdowns,",
    headlineBottom: "targets and snaps",
    subhead:
      "The season's leaders in passing, rushing and receiving, who is getting the targets and carries, and what every defense gives up.",
    facts: ["Updated every morning", "Free"],
    path: "/season/stats",
    badge: "Season Pulse",
  },
  "season-weather": {
    eyebrow: "NFL weather this week",
    headlineTop: "Wind, rain, or",
    headlineBottom: "a roof over it",
    subhead:
      "The forecast for every game this week, read for fantasy: which ones to downgrade, which to ignore, and which are indoors.",
    facts: ["Every game", "National Weather Service", "Free"],
    path: "/season/weather",
    badge: "Season Pulse",
  },
  "custom-rankings": {
    eyebrow: "Custom fantasy football rankings",
    headlineTop: "Build your own",
    headlineBottom: "rankings, two at a time",
    subhead:
      "Pick between two players at a time and your board builds itself. Start from our rankings, draw tiers, and see where you disagree.",
    facts: ["Free", "Tiers and IDP", "Share link"],
    path: "/tools/custom-rankings",
    badge: "Beacon Ranker",
  },
  "community-rankings": {
    eyebrow: "Community fantasy football rankings",
    headlineTop: "Everyone's boards,",
    headlineBottom: "merged into one",
    subhead:
      "Every saved Beacon Ranker board in a format, combined head to head into one ranking. No single board is ever shown.",
    facts: ["Free", "Every format", "Rebuilt nightly"],
    path: "/rankings/community",
    badge: "Community Rankings",
  },
  "manager-pulse": {
    eyebrow: "Sleeper manager report",
    headlineTop: "Know who you are",
    headlineBottom: "trading with",
    subhead:
      "Type a Sleeper handle and see how a manager actually plays: what they win, how they draft, and what they overpay for.",
    facts: ["Free", "Every season they played", "Sleeper"],
    path: "/tools/manager-pulse",
    badge: "Manager Pulse",
  },
  "my-beacon": {
    eyebrow: "Your FF Beacon account",
    headlineTop: "Your leagues and boards,",
    headlineBottom: "in one place",
    subhead:
      "Saved Sleeper leagues, custom ranking boards, draft trackers and bookmarks, kept together and synced across your devices.",
    facts: ["Free account", "Syncs everywhere"],
    path: "/my-beacon",
    badge: "My Beacon",
  },
  login: {
    eyebrow: "Sign in",
    headlineTop: "Save your handle.",
    headlineBottom: "Skip the typing.",
    subhead:
      "A free account remembers your Sleeper username, keeps your ranking boards, and lets you vote in the games.",
    facts: ["Free", "Google, Discord or email"],
    path: "/login",
    badge: "Sign in",
  },
  privacy: {
    eyebrow: "Privacy policy",
    headlineTop: "What we collect,",
    headlineBottom: "and how to delete it",
    subhead:
      "What FF Beacon stores, why it stores it, who it is shared with, what happens when you donate, and how to remove all of it.",
    facts: ["Plain English", "No data sold"],
    path: "/privacy",
    badge: "Privacy",
  },
  terms: {
    eyebrow: "Terms of service",
    headlineTop: "The rules for",
    headlineBottom: "using FF Beacon",
    subhead:
      "What you can do with the site, what we expect in return, how donations work, and how the service is provided.",
    facts: ["Plain English"],
    path: "/terms",
    badge: "Terms",
  },
  "free-agent-finder": {
    eyebrow: "Free agent finder",
    headlineTop: "Is he free in",
    headlineBottom: "any of my leagues?",
    subhead:
      "One name, every league you have connected, and the ones where he is still sitting there unowned.",
    facts: ["Free", "All your leagues at once", "Sleeper"],
    path: "/tools/free-agent-finder",
    badge: "Free Agent Finder",
  },
  "beacon-breakdown": {
    eyebrow: "Start / Sit",
    headlineTop: "Who should",
    headlineBottom: "I start?",
    subhead:
      "Put your players in. Get a start/sit verdict built from this week's projections and matchups.",
    facts: ["Free", "No signup", "Any players, any format"],
    path: "/tools/who-should-i-start",
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
  "would-you-rather": {
    eyebrow: "Trade voting game",
    headlineTop: "Two sides.",
    headlineBottom: "One vote.",
    subhead:
      "A real trade out of a real league, with the names taken off. Call the winner, then see the room and the full grade.",
    facts: ["Real trades", "Free to play", "No account for two"],
    path: "/games/would-you-rather",
    badge: "Would You Rather?",
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
  donate: {
    eyebrow: "Support FF Beacon",
    headlineTop: "Free for everyone,",
    headlineBottom: "paid for by one person",
    subhead:
      "No subscription, no paywall, nothing locked behind a tier. If the tools have been useful, you can put something back.",
    facts: ["One-time", "Card, Apple Pay, PayPal"],
    path: "/donate",
    badge: "Donate",
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
  const card = Object.hasOwn(PAGE_CARDS, key) ? PAGE_CARDS[key] : undefined;
  if (!card) {
    return new Response("Not found", { status: 404 });
  }
  return renderHeadlineCard({
    ...card,
    footerLeft: card.path === "/" ? "ffbeacon.com" : `ffbeacon.com${card.path}`,
  });
}
