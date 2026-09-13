/**
 * The long-form description of every tool, in one place.
 *
 * `lib/site.ts` TOOLS_NAV already holds the label, the route, and the one line
 * that fits in a menu. This holds the paragraph and the four bullets: what the
 * tool is for, and what a reader actually gets from it. Three surfaces read it
 * and they must not disagree, because two of them are how a machine learns what
 * this site does:
 *
 *   app/tools/page.tsx        the section per tool on the all-tools page
 *   app/llms.txt/route.ts     the curated map handed to answer engines
 *   app/llms-full.txt/route.ts the full context document
 *
 * Presentation-free on purpose, the same way TOOLS_NAV is. The icon lives with
 * the page that draws one, keyed by href, matching how lib/nav-tree.ts resolves
 * its own icons.
 *
 * Order matches TOOLS_NAV in lib/site.ts: league-pulse, trade-calculator,
 * who-should-i-start, faab, manager-pulse, on-the-clock. It drives the two
 * machine-readable documents as well as the all-tools page, so a reorder in one
 * place is a reorder here too.
 *
 * The rankings board is deliberately absent: it is a reference surface with its
 * own top-level route rather than something you run against your own league.
 */

/** Every route this catalog covers. Adding a tool means adding it here too. */
export type ToolHref =
  | "/tools/league-pulse"
  | "/tools/on-the-clock"
  | "/tools/manager-pulse"
  | "/tools/who-should-i-start"
  | "/tools/trade-calculator"
  | "/tools/faab";

export type ToolCatalogEntry = {
  href: ToolHref;
  /** The category the tool sits in, e.g. "Trade analysis". */
  eyebrow: string;
  /** Full product name, as it reads in a heading. */
  title: string;
  /** One paragraph: what the tool is and what it answers. */
  pitch: string;
  /** What a reader gets, one line each. */
  bullets: string[];
  /** The action, as a button would say it. */
  cta: string;
};

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    href: "/tools/league-pulse",
    eyebrow: "League management",
    title: "Sleeper League Pulse",
    pitch:
      "Bring every Sleeper league you're in into one place. See your full roster portfolio at a glance, with values and standings tuned to each league's actual scoring.",
    bullets: [
      "Every league tied to your Sleeper username, and saving it once means no typing at all",
      "Real rosters, recent trades, and accurate draft pick values",
      "Power rankings calibrated to your league's actual settings",
      "Tap any team to see a full breakdown of their roster",
    ],
    cta: "Sync a league",
  },
  {
    href: "/tools/trade-calculator",
    eyebrow: "Trade analysis",
    title: "Signal Check Trade Calculator",
    pitch:
      "Build any trade in our fantasy football trade calculator and get the Beacon Verdict: who wins, by how much, and why. Powered by FF Beacon Values and weighted for your league format, with a plain-language reason for every call.",
    bullets: [
      "Add players and, in dynasty, draft picks to either side",
      "FF Beacon Values weighted to your exact league format",
      "A clear margin and a near-even guard so tiny edges aren't oversold",
      "Freeze and share a clean public verdict link",
    ],
    cta: "Analyze a trade",
  },
  {
    href: "/tools/who-should-i-start",
    eyebrow: "Start / Sit",
    title: "Beacon Breakdown: Who Should I Start?",
    pitch:
      "Put two to eight players in, say how many you start, and get a start or sit call for this week, built from projections, matchups and each player's record against the projection.",
    bullets: [
      "A START or SIT call on every player, ordered by this week's projected points",
      "The chance your last starter outscores your best bench option",
      "Matchup, implied team total and floor and ceiling on every card",
      "Head to head, projection, reliability, market and stats tabs underneath",
    ],
    cta: "Find out who to start",
  },
  {
    href: "/tools/faab",
    eyebrow: "Waivers & bids",
    title: "FAAB Calculator",
    pitch:
      "Take the guesswork out of waiver Tuesday. Get a recommended bid range that factors in the player's actual value and how badly your roster needs them.",
    bullets: [
      "Search any player, not just the top names everyone is chasing",
      "Bids weighted by current value, your league size, and remaining FAAB",
      "Adjusts for your roster's positional need at that spot",
      "Explains the recommendation in plain English so you can adjust",
    ],
    cta: "Run a bid",
  },
  {
    href: "/tools/manager-pulse",
    eyebrow: "Know your league mates",
    title: "Manager Pulse",
    pitch:
      "Type any Sleeper username and see how that person actually plays. Four seasons of their real history, so you know who you are dealing with before you send the offer.",
    bullets: [
      "The players they keep buying, and the ones they never touch",
      "What they overpay for, priced against real market value",
      "How they draft, how often they win, how fast they move",
      "Dynasty and redraft kept apart, because they are different games",
    ],
    cta: "Scout a manager",
  },
  {
    href: "/tools/on-the-clock",
    eyebrow: "Live drafts",
    title: "On The Clock",
    pitch:
      "Connect your active Sleeper draft and FF Beacon points you to the best pick for your team, then keeps everything else you need in one hub. Built to work the same by eye or by ear.",
    bullets: [
      "Best Available and Team Need picks tuned to your league format",
      "A trade calculator and an analyzer for startup and rookie drafts",
      "Every team roster plus the full trade and transaction history",
      "Live power rankings, startup draft grades, and awards",
    ],
    cta: "Open the draft room",
  },
];
