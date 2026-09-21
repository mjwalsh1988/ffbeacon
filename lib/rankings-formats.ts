/**
 * Human and search-facing naming for a ranking format.
 *
 * `format_configs.display_name` is written for the header popover, where space is
 * tight ("Dynasty PPR SF", "Redraft 1QB Half PPR"). Those abbreviations are wrong for
 * a page title and an h1, which need the words people actually type: "superflex", not
 * "SF"; "TE Premium", not "TEP". This module derives that phrasing from the format's
 * structural columns rather than a hardcoded map, so a new format added to
 * format_configs gets a correctly-named page with no code change.
 */

export interface RankingFormat {
  slug: string;
  display_name: string;
  league_type: string;
  scoring_type: string;
  is_superflex: boolean;
  te_premium_bonus: number | string | null;
}

/**
 * Best ball is carried in the slug prefix, not a column: those formats reuse
 * league_type redraft/dynasty because the underlying values are the same shape.
 */
export function isBestBall(slug: string): boolean {
  return slug.startsWith("bestball-");
}

function hasTePremium(bonus: RankingFormat["te_premium_bonus"]): boolean {
  return Number(bonus ?? 0) > 0;
}

function scoringLabel(scoringType: string): string {
  if (scoringType === "ppr") return "PPR";
  if (scoringType === "half_ppr") return "Half PPR";
  if (scoringType === "standard") return "Standard";
  return scoringType.replace(/_/g, " ");
}

function leagueLabel(leagueType: string): string {
  if (leagueType === "dynasty") return "Dynasty";
  if (leagueType === "redraft") return "Redraft";
  return leagueType.charAt(0).toUpperCase() + leagueType.slice(1);
}

/**
 * Title-case phrase naming the format, e.g. "Dynasty Superflex PPR".
 *
 * Order runs broad to narrow (product, league type, quarterback rules, scoring, tight
 * end rules) so the phrase reads the way people say it out loud.
 */
export function formatPhrase(format: RankingFormat): string {
  return [
    isBestBall(format.slug) ? "Best Ball" : null,
    leagueLabel(format.league_type),
    format.is_superflex ? "Superflex" : "1QB",
    scoringLabel(format.scoring_type),
    hasTePremium(format.te_premium_bonus) ? "TE Premium" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Same phrase in sentence case, for use inside a sentence or an h1. */
export function formatPhraseLower(format: RankingFormat): string {
  // "PPR", "1QB", and "TE Premium" are initialisms and proper terms; only the words
  // that are ordinary English get lowercased.
  return formatPhrase(format)
    .replace(/\bBest Ball\b/, "best ball")
    .replace(/\bDynasty\b/, "dynasty")
    .replace(/\bRedraft\b/, "redraft")
    .replace(/\bSuperflex\b/, "superflex")
    .replace(/\bStandard\b/, "standard")
    .replace(/\bHalf PPR\b/, "half PPR");
}

/**
 * The same phrase as `formatPhrase`, worked out from the SLUG ALONE.
 *
 * The breadcrumb bar (lib/breadcrumbs.ts) is synchronous and slug-based: it
 * draws a trail from a pathname with no database in reach, so it fell back to
 * `humanizeSegment` and published "Dynasty PPR TEP Sflex" as the crumb, and as
 * the name inside the BreadcrumbList structured data, on a page whose own h1
 * says "dynasty superflex PPR TE Premium". Two different names for one page is
 * exactly what a breadcrumb is not for.
 *
 * Slug shape, in order, with everything but the scoring token optional:
 * `[bestball-][dynasty|redraft-]<ppr|half|std>[-tep][-sflex|-std]`. An absent
 * league reads as redraft and an absent quarterback token as 1QB, which is how
 * `format_configs` stores the best ball rows. Anything that does not parse
 * cleanly returns null, so an unfamiliar slug falls back to the old humanized
 * label rather than being guessed at.
 */
const SCORING_FROM_SLUG: Record<string, string> = {
  ppr: "PPR",
  half: "Half PPR",
  std: "Standard",
};

export function formatPhraseFromSlug(slug: string): string | null {
  const tokens = slug.split("-").filter(Boolean);
  let i = 0;

  const bestBall = tokens[i] === "bestball";
  if (bestBall) i += 1;

  let league = "redraft";
  if (tokens[i] === "dynasty" || tokens[i] === "redraft") {
    league = tokens[i];
    i += 1;
  }

  const scoring = SCORING_FROM_SLUG[tokens[i] ?? ""];
  if (!scoring) return null;
  i += 1;

  const tePremium = tokens[i] === "tep";
  if (tePremium) i += 1;

  let superflex = false;
  if (tokens[i] === "sflex" || tokens[i] === "std") {
    superflex = tokens[i] === "sflex";
    i += 1;
  }

  // Anything left over is a shape this parser does not know about.
  if (i !== tokens.length) return null;

  return [
    bestBall ? "Best Ball" : null,
    leagueLabel(league),
    superflex ? "Superflex" : "1QB",
    scoring,
    tePremium ? "TE Premium" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export interface RankingsSeoCopy {
  /** <title>, before the site template appends the brand. */
  title: string;
  /** Meta description. */
  description: string;
  /** h1 text. */
  headline: string;
  /** Lead paragraph under the h1. */
  intro: string;
}

/**
 * Per-format title, description, h1, and intro.
 *
 * Titles stay short on purpose. The root layout appends " | FF Beacon" (12
 * characters), so a base title much past 48 gets truncated in results. "{phrase}
 * Rankings" keeps even the longest format inside that budget, while the h1 and the
 * intro have room to spell things out for a reader.
 */
export function rankingsSeoCopy(format: RankingFormat): RankingsSeoCopy {
  const phrase = formatPhrase(format);
  const lower = formatPhraseLower(format);
  const isDynasty = format.league_type === "dynasty";

  const horizon = isDynasty
    ? "long-term value for keeper and dynasty rosters"
    : "value for this season only";

  const qbNote = format.is_superflex
    ? "Quarterbacks are priced for a league that starts two of them, so they sit far higher than in a single-quarterback build."
    : "Quarterbacks are priced for a single-quarterback lineup, which pushes running backs and receivers up the board.";

  const teNote = hasTePremium(format.te_premium_bonus)
    ? " Tight ends carry the TE premium bonus, which lifts the position relative to standard scoring."
    : "";

  return {
    title: `${phrase} Rankings`,
    description: `${phrase} fantasy football rankings, sorted by market value and updated daily, with 30-day value and rank movement, positional tiers, and scarcity gaps.`,
    headline: `${lower} fantasy football rankings`,
    intro: `Every ranked player in ${phrase}, sorted by ${horizon}. ${qbNote}${teNote} Sort any column, filter by position, and switch data source without losing your place.`,
  };
}
