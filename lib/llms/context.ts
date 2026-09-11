import { SITE } from "@/lib/site";

/**
 * The prose both machine-readable documents share.
 *
 * Everything in here is a claim about FF Beacon, so every sentence has to be
 * true of the CURRENT build and already public. Two rules keep it that way:
 *
 *  1. Nothing is asserted that a reader could not verify on the site. No user
 *     counts, no accuracy figures, no awards, no partnerships, no capability
 *     that is not shipped. If a number would go stale, it is read from the
 *     database at request time instead of being typed here (see ./data.ts).
 *  2. Anything with a machine-readable source of truth is READ from it rather
 *     than restated. Tool descriptions come from lib/tools-catalog.ts, guides
 *     from lib/guides/published.ts, formats and value sources and Brief
 *     categories from the database. What is left here is the narrative that has
 *     no registry: what the site is for, how it treats its data, and how it is
 *     paid for.
 *
 * The wording tracks the pages it describes: /about for the mission, the
 * accessibility rules and the data model, /donate for the funding, and each
 * tool's own page for its summary.
 */

/** The blockquote directly under the H1 of /llms.txt. One dense sentence set. */
export const SITE_SUMMARY =
  "FF Beacon is a free fantasy football site: player values and rankings across redraft, dynasty and best ball formats, tools for trades, drafts, waivers and Sleeper league analysis, an NFL news desk called The Beacon Brief, plain-English guides, and a Discord community. Every page is built to work with a screen reader.";

/** The paragraphs that follow the blockquote. Short, and each says one thing. */
export const SITE_CONTEXT: string[] = [
  "Everything on the site is free and nothing is paywalled. An account is optional and only exists to save things: a Sleeper username, bookmarks, a public profile, and a vote in the trade game. Reading rankings, grading a trade, syncing a league, and every article need no account at all.",
  "Player values are always scoped to two things: a value source and a league format. A value quoted without both is incomplete. The reader picks both in the site header and the whole site follows that choice. Inside a synced league the format is instead derived from that league's own Sleeper scoring settings, because a trade only ever meant anything in the league it happened in.",
  "All times shown anywhere on the site are US Eastern with the zone label attached.",
];

/** How the site is funded and what that means for a reader. From /donate and /about. */
export const FUNDING: string[] = [
  "FF Beacon is self funded by one person. There is no subscription, no paywall, no locked tier and no company behind it.",
  "Donations are welcome and entirely optional. A donation is a gift rather than a purchase, so it buys no tier, no early access and no advantage anywhere on the site, and it is not refunded.",
];

/** The six rules from the /about accessibility panel. */
export const ACCESSIBILITY: string[] = [
  "Semantic HTML first. A button is a button. ARIA is used where HTML cannot express the meaning, not as a substitute for it.",
  "Everything works by keyboard. Every control is reachable and operable without a mouse, and the focus ring is never removed without a replacement.",
  "Nothing is dropped on a phone. When a table will not fit, the row restacks. A column is never hidden at a breakpoint to make the layout easier.",
  "Color never carries meaning alone. Every colored state is paired with text, so a verdict reads the same to a screen reader as it looks on the page.",
  "Contrast has a floor. WCAG AA is the minimum anything ships at, and AAA is the target wherever the type size allows it.",
  "One time zone, always labeled. Every timestamp is shown in US Eastern with the zone attached, so nothing depends on what the reader's device believes.",
];

/** How values, formats, sources and projections relate. From the /about data panel. */
export const DATA_MODEL: string[] = [
  "A value source is the opinion behind a number. FF Beacon publishes its own value alongside several named third-party sources, and the reader chooses which one the site runs on. FF Beacon's own value is a separate model from the third-party ones and is never presented as theirs, nor theirs as ours.",
  "A source only offers the formats it genuinely publishes. Where a source does not cover the reader's chosen format, the format dropdown hides that format and the source dropdown warns before the click, rather than silently substituting a number copied sideways from a format it was not built for.",
  "Values rebuild nightly and the trend windows recalculate with them, so a seven-day move covers seven real days.",
  "Weekly projections are rescored under each league format's own rules rather than read off a generic column, which is why a tight end premium actually counts.",
  "Draft pick values are published for dynasty formats only. Redraft picks are not fabricated.",
];

/** The one league platform the site integrates with, and what that integration does. */
export const SLEEPER_INTEGRATION: string[] = [
  "Sleeper is the only fantasy platform FF Beacon connects to. A Sleeper username is enough to look up leagues, and no Sleeper password or authorization is ever asked for.",
  "A synced league is read from Sleeper's public API: rosters, members, drafts, matchups and transaction history. The league's own scoring settings then drive every number shown inside that league, rather than the reader's global format choice.",
  "League analysis is computed when a league is opened and cached, never by crawling every league on a schedule.",
];

/**
 * Terms this product coined, defined once.
 *
 * These are the words a model is most likely to meet with no idea what they
 * mean, because they exist nowhere else. Each definition says what the thing
 * measures rather than how it is computed. The method is written out in plain
 * English at /guides/how-ff-beacon-works for anyone who wants the how.
 */
export const BEACON_TERMS: Array<{ term: string; definition: string }> = [
  {
    term: "FF Beacon Values",
    definition:
      "FF Beacon's own player and draft pick value scale, offered as one selectable value source beside the third-party ones. It is a separate opinion from KeepTradeCut, FantasyCalc or DynastyProcess, and the site labels which source a number came from wherever one is shown.",
  },
  {
    term: "Beacon Verdict",
    definition:
      "The plain-English result the trade calculator returns: which side wins, the margin as a share of the total value in the deal, the shape of the trade, and a stated confidence. It is the output of Signal Check.",
  },
  {
    term: "Signal Check",
    definition:
      "The name of FF Beacon's fantasy football trade calculator. It prices both sides of a trade, players and dynasty draft picks together, in a chosen league format, and returns the Beacon Verdict.",
  },
  {
    term: "Start/sit verdict",
    definition:
      "Beacon Breakdown's answer to who should I start: two to eight players ranked by this week's projected points under the reader's scoring, the chosen number marked START and the rest SIT, with a confidence figure giving the chance the last starter outscores the best benched player.",
  },
  {
    term: "Beacon Edge",
    definition:
      "The head-to-head meter in Beacon Breakdown's background tabs, ranking the compared players on value, production, role and outlook under a Dynasty, Win now or This week lens.",
  },
  {
    term: "Power Pulse",
    definition:
      "A League Pulse score estimating how many games a team should win from here, ranked within its own league on a 1 to 99 scale. It is a competitive score built from the remaining schedule and each roster's projected weekly output under the league's own scoring, so it never counts draft picks: a future pick cannot start in a lineup.",
  },
  {
    term: "Positional WAR",
    definition:
      "A League Pulse curve, one line per position, showing wins over replacement by position rank for the specific league being viewed. It answers which positions are worth spending on in that league. It reads no roster and is deliberately player-independent, which is why it can disagree with a team-specific projection.",
  },
  {
    term: "Manager Ledger",
    definition:
      "The League Pulse Decisions page. It grades the person rather than the roster, over settled weeks only: lineups set against the best lineup that was available, waiver claims, trades, and draft picks. Nothing on it is a projection.",
  },
  {
    term: "The Beacon Brief",
    definition:
      `FF Beacon's NFL news desk, written for fantasy managers. Every story leads with what the news does to a roster rather than only what happened. Stories are drafted by FF Beacon's automated news desk from public reporting and published under the FF Beacon byline, with a note on every article saying so. ${SITE.author.name} built the desk and oversees it.`,
  },
  {
    term: "BEAM",
    definition:
      "The site's built-in question answering assistant, available on desktop only. It answers questions about players and values from the same data the pages render, and says so when a question is outside what it can see.",
  },
  {
    term: "Signal profile",
    definition:
      "An optional public profile a signed-in reader can publish at their own handle, showing what they choose to show. Nothing about a reader is public unless they set it up.",
  },
];

/** What the news desk is for. The per-category descriptions come from the database. */
export const BRIEF_CONTEXT: string[] = [
  "The Beacon Brief publishes NFL news selected for fantasy relevance. A story is written when it changes what a manager should do: an injury, a transaction, a depth chart or usage shift, a suspension, a coaching or scheme change, a notable performance, or rookie and draft news.",
  "News with no fantasy bearing is deliberately not covered, and articles that turn out to have none are removed rather than kept for traffic.",
  `Articles are drafted by FF Beacon's automated news desk from public reporting and published under the FF Beacon byline, with a note on every article saying so. ${SITE.author.name} built the desk and oversees it.`,
];

/** Guidance for a model quoting the site. Practical, not legal. */
export const CITATION_NOTES: string[] = [
  "Attribution is welcome. Please cite FF Beacon and link the specific page the answer came from.",
  "Player values change daily. Quote the date, the league format and the value source shown on the page rather than presenting a value as permanent.",
  "Beacon Brief articles are drafted from public reporting. Where an article names the original reporter, credit that reporter as well as FF Beacon.",
  "Do not present a third-party value source's numbers as FF Beacon's own model, or the other way round. The site keeps them apart and so should any answer drawn from it.",
  "Anything under /leagues/, /tools/manager-pulse/<handle> or a reader's own account is generated from one person's league or Sleeper history. Those pages are not part of this corpus and should not be crawled or quoted as site content.",
];
