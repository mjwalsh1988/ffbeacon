/**
 * One sentence describing what a league format actually is.
 *
 * Both documents need this and they must not disagree, and an earlier draft
 * that built the clause inline in each of them proved why: the curated map's
 * version emitted "(dynasty, ppr, superflex)" for BOTH `dynasty-ppr-sflex` and
 * `dynasty-ppr-tep-sflex`, because it never mentioned the tight end premium.
 * Two of thirteen entries were then indistinguishable on the one attribute that
 * separates them, in a file whose whole purpose is letting a model pick a link
 * without fetching it.
 *
 * The structural facts come from the same columns `lib/rankings-formats.ts`
 * reads, so a format added to `format_configs` describes itself here with no
 * code change, exactly as it names itself on its own rankings page.
 */

import { isBestBall, type RankingFormat } from "@/lib/rankings-formats";

const SCORING: Record<string, string> = {
  ppr: "full PPR",
  half_ppr: "half PPR",
  standard: "standard scoring, no point per reception",
};

export function hasTePremium(format: RankingFormat): boolean {
  return Number(format.te_premium_bonus ?? 0) > 0;
}

/** e.g. "dynasty, full PPR, superflex, tight end premium". */
export function describeFormat(format: RankingFormat): string {
  return [
    format.league_type,
    isBestBall(format.slug) ? "best ball" : null,
    SCORING[format.scoring_type] ?? format.scoring_type.replace(/_/g, " "),
    format.is_superflex ? "superflex" : "one quarterback",
    hasTePremium(format) ? "tight end premium" : null,
  ]
    .filter(Boolean)
    .join(", ");
}
