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

  // league_type: Sleeper settings.type === 2 indicates dynasty.
  // previous_league_id being a non-empty string also indicates a
  // multi-season league (dynasty / keeper carryover).
  const sleeperType = Number(settings.type ?? 0);
  const hasPriorSeason =
    typeof league.previous_league_id === "string" && league.previous_league_id.length > 0;
  const league_type: DerivedFormat["league_type"] =
    sleeperType === 2 || hasPriorSeason ? "dynasty" : "redraft";

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
 * Active slugs (see migration 0001):
 *   redraft-ppr-std, redraft-half-std, redraft-std-std,
 *   redraft-ppr-sflex, redraft-ppr-tep,
 *   dynasty-ppr-std, dynasty-ppr-sflex, dynasty-ppr-tep-sflex
 */
export function mapToFormatSlug(derived: DerivedFormat): string | null {
  const { league_type, scoring_type, is_superflex, is_tep } = derived;

  if (league_type === "dynasty") {
    // We only carry PPR dynasty formats today.
    if (scoring_type !== "ppr") return null;
    if (is_superflex && is_tep) return "dynasty-ppr-tep-sflex";
    if (is_superflex) return "dynasty-ppr-sflex";
    if (is_tep) return null; // dynasty-ppr-tep not yet configured
    return "dynasty-ppr-std";
  }

  // redraft
  if (is_superflex && scoring_type === "ppr" && !is_tep) return "redraft-ppr-sflex";
  if (is_superflex) return "redraft-ppr-sflex"; // closest available
  if (is_tep && scoring_type === "ppr") return "redraft-ppr-tep";

  if (scoring_type === "ppr") return "redraft-ppr-std";
  if (scoring_type === "half_ppr") return "redraft-half-std";
  return "redraft-std-std";
}

export function deriveFormatSlug(league: SleeperLeague): string | null {
  return mapToFormatSlug(deriveLeagueFormat(league));
}
