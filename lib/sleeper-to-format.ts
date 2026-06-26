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
