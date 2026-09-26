import { renderHeadlineCard } from "@/lib/og/headline-card";

export const runtime = "nodejs";

type GuideCard = {
  eyebrow: string;
  /** Rendered in default ink. */
  headlineTop: string;
  /** Rendered in the beacon gradient. */
  headlineBottom: string;
  subhead: string;
  /** Short label pinned bottom-right, e.g. a term count. */
  badge: string;
};

/**
 * Social cards for published guides, keyed by the guide's URL slug.
 *
 * One entry per guide. Adding a guide means adding a row here; a slug with no row
 * returns 404 rather than rendering a blank card, so a typo in a page's metadata
 * shows up as a missing image instead of an empty branded rectangle shared to X.
 */
const GUIDE_CARDS: Record<string, GuideCard> = {
  "fantasy-football-terms": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "Fantasy football terms",
    headlineBottom: "and abbreviations, explained",
    subhead:
      "PPR, FAAB, BN, OPRK, TEP, and every other word and abbreviation your league app assumes you already know.",
    badge: "Glossary",
  },
  "fantasy-football-draft-guide": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "The draft guide:",
    headlineBottom: "who the room is late on",
    subhead:
      "Steals, late-round swings, and fades in every format, from our own values and projected points above a replacement starter against real draft ADP.",
    badge: "Rebuilt nightly",
  },
  "positional-war-explained": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "Positional WAR explained:",
    headlineBottom: "the number that finds scarcity",
    subhead:
      "The replacement player, why scarcity beats raw points, and how to read the curve for your own league. Written for beginners, in plain English.",
    badge: "7 lessons",
  },
  "faab-strategy": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "FAAB strategy:",
    headlineBottom: "how much to bid on waivers",
    subhead:
      "Bid ranges for every kind of pickup, when to spend it all, who to drop, and the waiver wire mistakes that lose leagues in October.",
    badge: "8 lessons",
  },
  "fantasy-football-trade-guide": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "The trade guide:",
    headlineBottom: "how to judge any trade",
    subhead:
      "Value against wins, the 2-for-1 trap, buying low without fooling yourself, dynasty picks, timing, and how to pitch a trade that gets accepted.",
    badge: "8 lessons",
  },
  "superflex-strategy": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "Superflex strategy:",
    headlineBottom: "when everyone needs two",
    subhead:
      "What the slot changes, how many quarterbacks to roster in redraft, dynasty and best ball, when to draft them, how to trade the spare, and how TE premium stacks on top.",
    badge: "8 lessons",
  },
  "dynasty-strategy": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "Dynasty strategy:",
    headlineBottom: "contend or rebuild",
    subhead:
      "Find your lane, why the middle is the worst place to be, age against market price, rookie pick hit rates, the dynasty calendar, startups and taxi squads.",
    badge: "8 lessons",
  },
  "fantasy-football-playoffs": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "The playoff guide:",
    headlineBottom: "your odds and the title run",
    subhead:
      "What your playoff odds mean, luck against points for, buy or sell at the deadline, how much playoff schedules matter, and win-or-go-home lineups.",
    badge: "8 lessons",
  },
  "idp-fantasy-football": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "IDP fantasy football:",
    headlineBottom: "scoring decides the defense",
    subhead:
      "Linebackers, defensive linemen and defensive backs. How IDP scoring changes which of them matter, and how to draft and manage them.",
    badge: "10 lessons",
  },
  "faab-settings-by-platform": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "FAAB and waiver settings,",
    headlineBottom: "platform by platform",
    subhead:
      "What every waiver setting actually does on Sleeper, Yahoo, ESPN and NFL.com, and which ones change how your season plays.",
    badge: "4 platforms",
  },
  "chopped-league-strategy": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "Chopped and guillotine:",
    headlineBottom: "last score of the week is out",
    subhead:
      "One format under seven names. What to draft when a quiet Sunday ends your season, and how to spend a budget that never resets as the field shrinks.",
    badge: "Elimination leagues",
  },
};

/**
 * GET /api/og/guide/[slug]
 *
 * 1200x630 Open Graph and Twitter card for a published FF Beacon guide. Static
 * per slug, so it caches hard at the edge. Drawn by the shared headline card
 * (lib/og/headline-card.tsx), the same template as the fixed pages.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const card = Object.hasOwn(GUIDE_CARDS, slug) ? GUIDE_CARDS[slug] : undefined;
  if (!card) {
    return new Response("Not found", { status: 404 });
  }
  return renderHeadlineCard({ ...card, footerLeft: `ffbeacon.com/guides/${slug}` });
}
