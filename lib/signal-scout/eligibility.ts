/**
 * Player pool eligibility for Signal Scout (plan section 16).
 *
 * A player is eligible when every check below passes: position is in the
 * admin-configured pool, the player is currently fantasy relevant (rankings
 * membership within the rolling 90-day window, mirroring the "trust rankings,
 * not players.status/team" pattern in lib/player-search.ts), the required bio
 * fields are present, clue generation can produce enough clues, and the
 * player is not admin-hidden.
 *
 * This module is split into a pure evaluation core (evaluatePlayerEligibility)
 * and a Supabase loader (loadEligiblePool) so the admin Players page and any
 * future target-selection code can reuse the same rules without re-deriving
 * them. The clue-coverage check is a seam: clueCoverage is null until the
 * clue generator (a later task) supplies real counts, and a null coverage
 * always fails the check rather than silently passing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SignalScoutSettings, SignalTier } from "./types";

export type EligibilityCheckKey =
  | "position"
  | "rankings_window"
  | "required_fields"
  | "clue_coverage"
  | "not_hidden";

export interface EligibilityCheckResult {
  key: EligibilityCheckKey;
  label: string;
  pass: boolean;
  /** Short human-readable explanation. Plain ASCII, full sentences; rendered verbatim on the admin screen. */
  detail: string;
}

export interface EligibilityCheckDefinition {
  key: EligibilityCheckKey;
  label: string;
}

/** Catalog of every check, in evaluation order, so the admin page can render the full check list. */
export const ELIGIBILITY_CHECKS: EligibilityCheckDefinition[] = [
  { key: "position", label: "Eligible position" },
  { key: "rankings_window", label: "Rankings membership (90-day window)" },
  { key: "required_fields", label: "Required bio fields present" },
  { key: "clue_coverage", label: "Sufficient clue coverage" },
  { key: "not_hidden", label: "Not admin-hidden" },
];

export function listEligibilityChecks(): EligibilityCheckDefinition[] {
  return ELIGIBILITY_CHECKS;
}

/** Minimum valid starter candidates and minimum generatable clues per paid tier (plan section 16). */
const MIN_STARTER_CANDIDATES = 3;
const MIN_GENERATABLE_PER_TIER = 2;
const SIGNAL_TIERS: SignalTier[] = ["weak", "clear", "ping", "scan"];

export interface ClueCoverageInput {
  starterCandidates: number;
  generatableByTier: Record<SignalTier, number>;
}

export interface PlayerEligibilityInput {
  id: string;
  position: string;
  birth_date: string | null;
  years_experience: number | null;
  height_inches: number | null;
  weight_lbs: number | null;
  inRankingsWindow: boolean;
  hiddenOverride: boolean;
  eligiblePositions: string[];
  /** null means "not yet computed" (the clue generator has not run for this player). */
  clueCoverage: ClueCoverageInput | null;
}

export interface PlayerEligibilityResult {
  checks: EligibilityCheckResult[];
  eligible: boolean;
}

function checkPosition(input: PlayerEligibilityInput): EligibilityCheckResult {
  const positionList = input.eligiblePositions.join(", ");
  const pass = input.eligiblePositions.includes(input.position);
  const detail = pass
    ? `Position ${input.position} is in the eligible pool (${positionList}).`
    : `Position ${input.position} is not in the eligible pool (${positionList}).`;
  return { key: "position", label: "Eligible position", pass, detail };
}

function checkRankingsWindow(input: PlayerEligibilityInput): EligibilityCheckResult {
  const pass = input.inRankingsWindow;
  const detail = pass
    ? "Player appears in rankings within the last 90 days."
    : "Player has not appeared in rankings within the last 90 days.";
  return { key: "rankings_window", label: "Rankings membership (90-day window)", pass, detail };
}

function checkRequiredFields(input: PlayerEligibilityInput): EligibilityCheckResult {
  const missing: string[] = [];
  if (input.birth_date === null) missing.push("birth date");
  if (input.years_experience === null) missing.push("years of experience");
  if (input.height_inches === null) missing.push("height");
  if (input.weight_lbs === null) missing.push("weight");

  const pass = missing.length === 0;
  const detail = pass
    ? "Birth date, years of experience, height, and weight are all present."
    : `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`;
  return { key: "required_fields", label: "Required bio fields present", pass, detail };
}

function checkClueCoverage(input: PlayerEligibilityInput): EligibilityCheckResult {
  const label = "Sufficient clue coverage";
  const coverage = input.clueCoverage;
  if (coverage === null) {
    return { key: "clue_coverage", label, pass: false, detail: "Clue coverage not computed" };
  }

  const starterOk = coverage.starterCandidates >= MIN_STARTER_CANDIDATES;
  const shortTiers = SIGNAL_TIERS.filter(
    (tier) => coverage.generatableByTier[tier] < MIN_GENERATABLE_PER_TIER,
  );
  const pass = starterOk && shortTiers.length === 0;

  if (pass) {
    return {
      key: "clue_coverage",
      label,
      pass,
      detail: `${coverage.starterCandidates} starter candidates and at least ${MIN_GENERATABLE_PER_TIER} generatable clues in every paid tier.`,
    };
  }

  const reasons: string[] = [];
  if (!starterOk) {
    const noun = coverage.starterCandidates === 1 ? "candidate" : "candidates";
    reasons.push(
      `only ${coverage.starterCandidates} starter ${noun} (need at least ${MIN_STARTER_CANDIDATES})`,
    );
  }
  if (shortTiers.length > 0) {
    const tierList = shortTiers
      .map((tier) => `${tier} (${coverage.generatableByTier[tier]})`)
      .join(", ");
    const noun = shortTiers.length > 1 ? "tiers" : "tier";
    reasons.push(`not enough generatable clues in ${noun}: ${tierList}`);
  }
  return { key: "clue_coverage", label, pass, detail: `Clue coverage is insufficient: ${reasons.join("; ")}.` };
}

function checkNotHidden(input: PlayerEligibilityInput): EligibilityCheckResult {
  const pass = !input.hiddenOverride;
  const detail = pass ? "Player is not admin-hidden." : "Player is hidden by an admin override.";
  return { key: "not_hidden", label: "Not admin-hidden", pass, detail };
}

/** Pure evaluation core: no I/O, safe to unit test directly and to reuse from the admin Players page. */
export function evaluatePlayerEligibility(input: PlayerEligibilityInput): PlayerEligibilityResult {
  const checks: EligibilityCheckResult[] = [
    checkPosition(input),
    checkRankingsWindow(input),
    checkRequiredFields(input),
    checkClueCoverage(input),
    checkNotHidden(input),
  ];
  return { checks, eligible: checks.every((check) => check.pass) };
}

/**
 * A player is fantasy relevant when a source has ranked them within this
 * window. Mirrors RELEVANCE_WINDOW_DAYS in lib/player-search.ts: rankings
 * membership, not players.status/team, is the trustworthy "currently
 * relevant" signal (players.team carries offseason false-nulls; status is
 * unreliable for filtering retired/inactive players out).
 */
const RANKINGS_WINDOW_DAYS = 90;

// Explicit high limits to override PostgREST's 1000-row default (see
// lib/player-search.ts fantasyRelevantPlayerIds for the same pattern).
const MAX_CANDIDATE_PLAYERS = 20000;
const MAX_RANKED_PLAYER_IDS = 50000;

export type PlayerEligibilityInputWithoutCoverage = Omit<PlayerEligibilityInput, "clueCoverage">;

/**
 * Assemble per-player evaluation inputs for every player in the admin-configured
 * position pool. Does not compute clueCoverage: callers (the eligibility screen,
 * and eventually target selection) layer that in once the clue generator exists.
 */
export async function loadEligiblePool(
  supabase: SupabaseClient<Database>,
  settings: SignalScoutSettings,
): Promise<PlayerEligibilityInputWithoutCoverage[]> {
  const eligiblePositions: string[] = settings.pool.eligible_positions;

  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, position, birth_date, years_experience, height_inches, weight_lbs")
    .in("position", eligiblePositions)
    .limit(MAX_CANDIDATE_PLAYERS);
  if (playersError) throw playersError;

  const pool = players ?? [];
  if (pool.length === 0) return [];

  const cutoff = new Date(Date.now() - RANKINGS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: rankedRows, error: rankingsError } = await supabase
    .from("rankings")
    .select("player_id")
    .gte("generated_at", cutoff)
    .limit(MAX_RANKED_PLAYER_IDS);
  if (rankingsError) throw rankingsError;
  const rankedIds = new Set((rankedRows ?? []).map((row) => row.player_id));

  const { data: hiddenRows, error: hiddenError } = await supabase
    .from("signal_scout_player_overrides")
    .select("player_id")
    .eq("is_hidden", true);
  if (hiddenError) throw hiddenError;
  const hiddenIds = new Set((hiddenRows ?? []).map((row) => row.player_id));

  return pool.map((player) => ({
    id: player.id,
    position: player.position,
    birth_date: player.birth_date,
    years_experience: player.years_experience,
    height_inches: player.height_inches,
    weight_lbs: player.weight_lbs,
    inRankingsWindow: rankedIds.has(player.id),
    hiddenOverride: hiddenIds.has(player.id),
    eligiblePositions,
  }));
}
