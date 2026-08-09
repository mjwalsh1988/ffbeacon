import type { SleeperLeague } from "@/lib/sleeper";

export type DerivedFormat = {
  league_type: "redraft" | "dynasty";
  scoring_type: "ppr" | "half_ppr" | "standard";
  is_superflex: boolean;
  is_tep: boolean;
};

export function deriveLeagueFormat(league: SleeperLeague): DerivedFormat {
  const scoring = league.scoring_settings ?? {};
  const positions = league.roster_positions ?? [];
  const settings = league.settings ?? {};

  // league_type: Sleeper's own field is the only signal. 0 = redraft,
  // 1 = keeper, 2 = dynasty, 3 = chopped. Only type 2 is dynasty; keeper and
  // chopped leagues price as redraft, which is how they play.
  //
  // We do NOT read previous_league_id. Sleeper sets it on ANY league carried
  // season to season, redraft included, so treating it as a dynasty signal
  // priced continued redraft leagues (a real one: "Brooklyn 99 Redraft",
  // type 0, 16 rounds, with a prior season) off the dynasty board and told the
  // On The Clock room it was a dynasty startup. lib/league-category.ts already
  // classifies on type alone; this now matches it.
  const sleeperType = Number(settings.type ?? 0);
  const league_type: DerivedFormat["league_type"] =
    sleeperType === 2 ? "dynasty" : "redraft";

  // scoring_type: reception scoring is the deciding signal.
  const rec = Number(scoring.rec ?? 0);
  let scoring_type: DerivedFormat["scoring_type"] = "standard";
  if (rec >= 0.95) scoring_type = "ppr";
  else if (rec >= 0.4) scoring_type = "half_ppr";

  // is_superflex: explicit SUPER_FLEX slot or 2+ QB starting slots.
  const qbStarters = positions.filter((p) => p === "QB").length;
  const hasSuperflexSlot = positions.includes("SUPER_FLEX");
  const is_superflex = hasSuperflexSlot || qbStarters >= 2;

  // tep: typical TEP leagues boost rec_te by 0.5+ (some use bonus_rec_te,
  // others bake it into rec_te). Check both common Sleeper keys.
  const bonusTe = Number(scoring.bonus_rec_te ?? 0);
  const recTeBoost = Number(scoring.rec_te ?? 0);
  const is_tep = bonusTe >= 0.5 || recTeBoost >= 0.5;

  return { league_type, scoring_type, is_superflex, is_tep };
}

/**
 * Map a derived Sleeper format to the slug of one of FF Beacon's
 * format_configs rows. Returns the best matching slug, or null when no
 * configured format covers this combination (caller can then fall through
 * via lib/format-fallback.ts).
 *
 * Active slugs (migration 0001, extended by 0158):
 *   redraft-ppr-std, redraft-half-std, redraft-std-std,
 *   redraft-ppr-sflex, redraft-ppr-tep, redraft-ppr-tep-sflex,
 *   dynasty-ppr-std, dynasty-ppr-sflex, dynasty-ppr-tep, dynasty-ppr-tep-sflex
 *
 * All four TE-premium boards are FF Beacon derivations of their non-TEP
 * counterpart (see lib/calculate-beacon-values.ts INHERITED), and no external
 * source publishes values for the two redraft ones or for dynasty-ppr-tep. A
 * league that maps to a TEP board while the reader is on another source is not a
 * problem: resolveLeagueContext reports coverage 'fallback' and the view
 * explains the swap. That is a better answer than silently pricing a TE-premium
 * league off a board where tight ends are not premium.
 */
export function mapToFormatSlug(derived: DerivedFormat): string | null {
  const { league_type, scoring_type, is_superflex, is_tep } = derived;

  if (league_type === "dynasty") {
    // We only carry PPR dynasty formats today.
    if (scoring_type !== "ppr") return null;
    if (is_superflex && is_tep) return "dynasty-ppr-tep-sflex";
    if (is_superflex) return "dynasty-ppr-sflex";
    if (is_tep) return "dynasty-ppr-tep";
    return "dynasty-ppr-std";
  }

  // Redraft. Superflex is the single biggest value driver, so a superflex league
  // always lands on a superflex board even when its scoring does not match; PPR
  // is the only superflex scoring we carry. Within that, the TE premium picks
  // the board. This ordering (superflex, then scoring, then TE premium) is the
  // same one pickClosestSupportedFormat scores against below.
  if (is_superflex) return is_tep ? "redraft-ppr-tep-sflex" : "redraft-ppr-sflex";

  // 1QB. Here a scoring match beats a TE-premium match, because we do carry half
  // PPR and standard 1QB boards and neither has a TE-premium variant.
  if (is_tep && scoring_type === "ppr") return "redraft-ppr-tep";
  if (scoring_type === "ppr") return "redraft-ppr-std";
  if (scoring_type === "half_ppr") return "redraft-half-std";
  return "redraft-std-std";
}

export function deriveFormatSlug(league: SleeperLeague): string | null {
  return mapToFormatSlug(deriveLeagueFormat(league));
}

/** Plain-language label for a derived Sleeper format, e.g. "Dynasty PPR Superflex TE Premium". */
export function describeDerivedFormat(d: DerivedFormat): string {
  const league = d.league_type === "dynasty" ? "Dynasty" : "Redraft";
  const scoring =
    d.scoring_type === "ppr" ? "PPR" : d.scoring_type === "half_ppr" ? "Half PPR" : "Standard";
  const parts = [league, scoring];
  if (d.is_superflex) parts.push("Superflex");
  if (d.is_tep) parts.push("TE Premium");
  return parts.join(" ");
}

/** A supported format we can fall back to, with the structural flags we score against. */
export interface FormatCandidate {
  slug: string;
  display: string;
  league_type: "redraft" | "dynasty" | string;
  scoring_type: "ppr" | "half_ppr" | "standard" | string;
  is_superflex: boolean;
  is_tep: boolean;
  display_order: number | null;
}

/**
 * Pick the closest supported format to a derived Sleeper format when the exact
 * combination has no FF Beacon values yet (e.g. dynasty half-PPR, or a TEP
 * redraft we don't carry). NEVER crosses league_type: a redraft league only
 * ever maps to a redraft format and a dynasty league only to a dynasty format.
 *
 * Within the same league_type, closeness is scored by structural impact:
 * superflex (the biggest value driver) > scoring > TE premium, then the lowest
 * display_order breaks ties. Returns null only when no supported format shares
 * the league_type (which should not happen while both types have formats).
 */
export function pickClosestSupportedFormat(
  derived: DerivedFormat,
  candidates: FormatCandidate[],
): FormatCandidate | null {
  const sameLeague = candidates.filter((c) => c.league_type === derived.league_type);
  if (sameLeague.length === 0) return null;

  const scoreOf = (c: FormatCandidate) =>
    (c.is_superflex === derived.is_superflex ? 8 : 0) +
    (c.scoring_type === derived.scoring_type ? 4 : 0) +
    (c.is_tep === derived.is_tep ? 2 : 0);

  return [...sameLeague].sort((a, b) => {
    const diff = scoreOf(b) - scoreOf(a);
    if (diff !== 0) return diff;
    const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.slug.localeCompare(b.slug);
  })[0];
}
