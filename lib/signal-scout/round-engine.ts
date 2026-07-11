/**
 * Round engine for Signal Scout: the service-role orchestration layer
 * between the future API routes (Phase 3) and the database. Owns round
 * start, hint purchase, guess submission, skip, completion, and DTO
 * building. Every exported function is the single place a route is allowed
 * to touch signal_scout_rounds / signal_scout_round_clues /
 * signal_scout_guesses / signal_scout_user_stats / signal_scout_daily_scores.
 *
 * CONSISTENCY MODEL: supabase-js has no multi-statement transactions, and
 * Phase 1 deliberately shipped no completion RPC (see signal-scout-plan.md
 * part 3 section 19), so this engine uses status-guarded writes as its
 * idempotency anchor, matching the existing codebase pattern of sequential
 * service-role writes (lib/league-pulse.ts). Every round mutation is a
 * single UPDATE on signal_scout_rounds guarded by
 * .eq("id", round.id).eq("status", "active").eq("score_available", priorScore)
 * with .select().maybeSingle() to detect whether the guard matched:
 *
 *   - The round-row update is written FIRST, before any secondary write
 *     (a clue reveal, a signal_scout_guesses insert, or a stats/streak
 *     upsert). If the guard misses (status changed or score changed under
 *     us), the function returns "round_not_active" immediately and performs
 *     no secondary write. This is a deliberate simplification of the plan's
 *     "return round_not_active (or re-reading and retrying once)" allowance:
 *     this engine always returns the error rather than retrying, so callers
 *     get a fast, unambiguous answer and can decide whether to retry.
 *   - Ordering the round-row update first is what makes concurrent duplicate
 *     requests safe without a transaction: two racing wrong-guess submits
 *     both read the same priorScore, but only the first UPDATE's
 *     score_available=priorScore guard can match; the second necessarily
 *     misses (the first already advanced score_available) and is rejected
 *     as round_not_active before it ever inserts a guess row or touches
 *     stats. This is also why hint reveals and guess inserts happen AFTER
 *     the round-row update succeeds, not before.
 *   - A crash between the round-row update and its secondary write is an
 *     accepted, narrow inconsistency: the round's score/status is always
 *     left correct (never double-awarded, never double-completed, never
 *     resurrected), but a hint purchase could leave a paid-for clue
 *     unrevealed, or a completed round could be missing its
 *     signal_scout_guesses row, or stats/daily-score aggregates could sit
 *     one round behind. This mirrors the plan's own "stats one round
 *     behind" tolerance and is judged an acceptable trade against the cost
 *     of building real transactions on top of supabase-js.
 *
 * GUEST DAILY CAP BOUNDARY: startRound does NOT claim the guest daily round
 * cap. The atomic try_start_signal_scout_guest_round RPC claim is the
 * calling ROUTE's responsibility (Phase 3), invoked before startRound. This
 * engine only enforces ownership, one-active-round, and game_enabled; it has
 * no opinion on how many rounds a guest has played today.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { ClueTierLimits, ScoringSettings, SignalScoutSettings } from "./types";
import {
  loadEligiblePool,
  evaluatePlayerEligibility,
  type PlayerEligibilityInputWithoutCoverage,
} from "./eligibility";
import {
  assembleClueFacts,
  generateClueCandidates,
  applyDisabledKeys,
  selectStarterClues,
  computeClueCoverage,
  CLUE_DEFINITIONS,
  type ClueFactsPlayer,
  type GeneratedClue,
} from "./clues";
import { loadStatsBundle } from "./stats-bundle";
import {
  evaluateHintPurchase,
  applyWrongGuess,
  resolveCorrectGuess,
  tierCost,
  type HintErrorCode,
  type SignalTierKey,
} from "./scoring";
import {
  applyRoundOutcomeToStreaks,
  currentEasternGameDate,
  type RoundOutcome,
  type StreakState,
} from "./streaks";
import { loadSignalScoutSettings, validateSignalScoutSettings } from "./settings";
import { DEFAULT_SIGNAL_SCOUT_SETTINGS } from "./default-settings";

type Client = SupabaseClient<Database>;
type RoundRow = Database["public"]["Tables"]["signal_scout_rounds"]["Row"];
type RoundUpdate = Database["public"]["Tables"]["signal_scout_rounds"]["Update"];
type ClueRow = Database["public"]["Tables"]["signal_scout_round_clues"]["Row"];

// ---------------------------------------------------------------------------
// Identity and errors
// ---------------------------------------------------------------------------

export type RoundIdentity =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestId: string; ipHash: string };

/**
 * Typed error codes across every engine function. Game-rule violations
 * always come back as { ok: false, code }; unexpected DB errors throw.
 */
export type EngineError =
  | "not_found"
  | "round_not_active"
  | "game_disabled"
  | "active_round_exists"
  | "pool_empty"
  | "guess_duplicate"
  | "guess_out_of_pool"
  | "invalid_tier"
  | HintErrorCode;

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Settings snapshot parsing
// ---------------------------------------------------------------------------

/**
 * Every round mutation reads scoring/clue rules from the round's own frozen
 * settings_snapshot, never from live settings, so a mid-round admin change
 * never retroactively alters an in-progress round. Falls back to defaults on
 * a corrupt snapshot, matching loadSignalScoutSettings's own defensive style.
 */
function parseSettingsSnapshot(raw: Json): SignalScoutSettings {
  const result = validateSignalScoutSettings(raw);
  if (!result.ok) {
    console.error("[signal-scout] round settings_snapshot invalid, using defaults", result.error);
    return { ...DEFAULT_SIGNAL_SCOUT_SETTINGS };
  }
  return result.settings;
}

// ---------------------------------------------------------------------------
// Ownership and round/clue fetch helpers
// ---------------------------------------------------------------------------

function ownsRound(round: RoundRow, identity: RoundIdentity): boolean {
  if (identity.kind === "user") return round.user_id === identity.userId;
  return round.guest_id === identity.guestId;
}

/** Never leaks round existence: a round owned by someone else reads as not_found. */
async function fetchOwnedRound(supabase: Client, identity: RoundIdentity, roundId: string): Promise<RoundRow | null> {
  const { data, error } = await supabase.from("signal_scout_rounds").select("*").eq("id", roundId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (!ownsRound(data, identity)) return null;
  return data;
}

async function fetchRoundClues(supabase: Client, roundId: string): Promise<ClueRow[]> {
  const { data, error } = await supabase.from("signal_scout_round_clues").select("*").eq("round_id", roundId);
  if (error) throw error;
  return data ?? [];
}

async function findActiveRound(supabase: Client, identity: RoundIdentity): Promise<{ id: string } | null> {
  const base = supabase.from("signal_scout_rounds").select("id").eq("status", "active");
  const scoped = identity.kind === "user" ? base.eq("user_id", identity.userId) : base.eq("guest_id", identity.guestId);
  const { data, error } = await scoped.maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Public wrapper around findActiveRound for the POST /round route (Phase 3):
 * it must check for a resumable active round BEFORE spending a guest's
 * daily-cap claim, so a guest hitting Start twice does not burn a cap slot
 * on a no-op resume.
 */
export async function findActiveRoundId(supabase: Client, identity: RoundIdentity): Promise<string | null> {
  const round = await findActiveRound(supabase, identity);
  return round?.id ?? null;
}

/**
 * The guarded anchor write for a non-completing round mutation (a hint
 * purchase, or a wrong guess that does not fail the round). Guards on both
 * status="active" and the caller's priorScore; returns null when the guard
 * misses, which callers surface as round_not_active without any secondary
 * write.
 */
async function guardedActiveUpdate(supabase: Client, round: RoundRow, patch: RoundUpdate): Promise<RoundRow | null> {
  const { data, error } = await supabase
    .from("signal_scout_rounds")
    .update(patch)
    .eq("id", round.id)
    .eq("status", "active")
    .eq("score_available", round.score_available)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** The guarded anchor write for a round completion (won/solved_late/failed/skipped). */
async function completeRoundTransition(
  supabase: Client,
  round: RoundRow,
  patch: {
    status: "won" | "solved_late" | "failed" | "skipped";
    scoreAwarded: number;
    scoreAvailable: number;
    wrongGuessCount: number;
    burnedOutAt: string | null;
  },
): Promise<RoundRow | null> {
  const { data, error } = await supabase
    .from("signal_scout_rounds")
    .update({
      status: patch.status,
      score_awarded: patch.scoreAwarded,
      score_available: patch.scoreAvailable,
      wrong_guess_count: patch.wrongGuessCount,
      burned_out_at: patch.burnedOutAt,
      completed_at: nowIso(),
    })
    .eq("id", round.id)
    .eq("status", "active")
    .eq("score_available", round.score_available)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// ---------------------------------------------------------------------------
// Target selection (plan section 12)
// ---------------------------------------------------------------------------

/** Players ranked in the top N get the weighted boost; everyone else gets the tail chance for deep cuts. */
export const TOP_RANK_THRESHOLD = 150;
export const TOP_RANK_WEIGHT = 4;
export const TAIL_WEIGHT = 1;
/** How many of the identity's most recent distinct targets are excluded from selection. */
export const RECENT_TARGET_EXCLUSION_COUNT = 10;
/** Reroll budget before selectTarget gives up and reports pool_empty. */
export const MAX_TARGET_ATTEMPTS = 5;

/**
 * Fixed rank source for target-selection weighting only (a documented
 * departure from the value CLUE's own ffbeacon-then-ktc fallback in
 * clues.ts): "top 150" here is a rough popularity signal to bias selection,
 * not the number shown to the player, so a single fixed (format, source)
 * combo keeps the query small and the bias well-defined, at the cost of a
 * player who only has ktc rankings never counting as top-150. Reusing the
 * same dynasty-ppr-sflex/ffbeacon combo the value clue uses keeps the
 * player pool's "how highly regarded" signal internally consistent across
 * the game rather than introducing a second opinion.
 */
const TARGET_RANK_FORMAT_SLUG = "dynasty-ppr-sflex";
const TARGET_RANK_SOURCE = "ffbeacon";
// Explicit high limit to override PostgREST's 1000-row default (see
// lib/player-search.ts and eligibility.ts for the same pattern).
const MAX_RANKING_ROWS = 50000;
const RECENT_TARGET_LOOKBACK_ROWS = 200;

/** Structural-only eligibility (position, rankings window, required fields, not-hidden); clue coverage is not yet known. */
function passesStructuralEligibility(input: PlayerEligibilityInputWithoutCoverage): boolean {
  const result = evaluatePlayerEligibility({ ...input, clueCoverage: null });
  return result.checks.filter((c) => c.key !== "clue_coverage").every((c) => c.pass);
}

async function loadLatestOverallRanks(supabase: Client, poolIds: string[]): Promise<Map<string, number>> {
  const ranks = new Map<string, number>();
  if (poolIds.length === 0) return ranks;

  const { data: formatRow, error: formatError } = await supabase
    .from("format_configs")
    .select("id")
    .eq("slug", TARGET_RANK_FORMAT_SLUG)
    .maybeSingle();
  if (formatError) throw formatError;
  if (!formatRow) return ranks;

  const { data, error } = await supabase
    .from("rankings")
    .select("player_id, overall_rank, generated_at")
    .in("player_id", poolIds)
    .eq("format_config_id", formatRow.id)
    .eq("source", TARGET_RANK_SOURCE)
    .order("generated_at", { ascending: false })
    .limit(MAX_RANKING_ROWS);
  if (error) throw error;

  // Rows are ordered newest first, so the first row seen per player_id is
  // that player's latest overall_rank.
  for (const row of data ?? []) {
    if (!ranks.has(row.player_id) && row.overall_rank !== null) {
      ranks.set(row.player_id, row.overall_rank);
    }
  }
  return ranks;
}

async function loadRecentTargetIds(supabase: Client, identity: RoundIdentity): Promise<Set<string>> {
  const base = supabase
    .from("signal_scout_rounds")
    .select("target_player_id")
    .order("started_at", { ascending: false })
    .limit(RECENT_TARGET_LOOKBACK_ROWS);
  const scoped = identity.kind === "user" ? base.eq("user_id", identity.userId) : base.eq("guest_id", identity.guestId);
  const { data, error } = await scoped;
  if (error) throw error;

  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (seen.size >= RECENT_TARGET_EXCLUSION_COUNT) break;
    seen.add(row.target_player_id);
  }
  return seen;
}

type SignalScoutPlayerRow = ClueFactsPlayer & {
  first_name: string;
  full_name: string | null;
  external_ids: unknown;
};

async function loadFullPlayer(supabase: Client, playerId: string): Promise<SignalScoutPlayerRow | null> {
  const { data, error } = await supabase
    .from("players")
    .select(
      "id, position, first_name, last_name, full_name, birth_date, years_experience, height_inches, weight_lbs, college, team, metadata, external_ids",
    )
    .eq("id", playerId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export type WeightedTargetCandidate = { id: string; position: string; weight: number };

/**
 * Pure weighting step: assigns TOP_RANK_WEIGHT to players ranked within
 * TOP_RANK_THRESHOLD and TAIL_WEIGHT (the "tail chance for deep cuts") to
 * everyone else, after dropping any excluded id. Split from pickWeightedTarget
 * so both halves of the weighted-random design are independently unit
 * testable without randomness.
 */
export function weighTargetCandidates(
  pool: Array<{ id: string; position: string }>,
  ranks: Map<string, number>,
  excluded: Set<string>,
): WeightedTargetCandidate[] {
  return pool
    .filter((p) => !excluded.has(p.id))
    .map((p) => {
      const rank = ranks.get(p.id);
      const weight = rank !== undefined && rank <= TOP_RANK_THRESHOLD ? TOP_RANK_WEIGHT : TAIL_WEIGHT;
      return { id: p.id, position: p.position, weight };
    });
}

/** Pure weighted-random pick. Returns null when candidates is empty. */
export function pickWeightedTarget(
  candidates: WeightedTargetCandidate[],
  rng: () => number,
): WeightedTargetCandidate | null {
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  let r = rng() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

export type TargetSelectionResult =
  | { ok: true; player: SignalScoutPlayerRow; candidates: GeneratedClue[]; starters: GeneratedClue[] }
  | { ok: false; code: "pool_empty" };

/**
 * Lazy-verify target selection (plan section 12): loads the structurally
 * eligible pool WITHOUT clue coverage (computing coverage for the whole pool
 * would be hundreds of queries per round start), picks a weighted-random
 * candidate, then generates that ONE candidate's full clue file and verifies
 * complete eligibility including coverage. A coverage failure rerolls,
 * excluding the failed candidate, up to MAX_TARGET_ATTEMPTS times.
 */
async function selectTarget(
  supabase: Client,
  identity: RoundIdentity,
  settings: SignalScoutSettings,
  rng: () => number,
): Promise<TargetSelectionResult> {
  const rawPool = await loadEligiblePool(supabase, settings);
  const structuralPool = rawPool.filter(passesStructuralEligibility);
  if (structuralPool.length === 0) return { ok: false, code: "pool_empty" };

  const poolIds = structuralPool.map((p) => p.id);
  const ranks = await loadLatestOverallRanks(supabase, poolIds);
  const excluded = await loadRecentTargetIds(supabase, identity);

  const structuralById = new Map(structuralPool.map((p) => [p.id, p]));
  const tried = new Set<string>();

  for (let attempt = 0; attempt < MAX_TARGET_ATTEMPTS; attempt++) {
    const excludeSet = new Set<string>([...excluded, ...tried]);
    const weighted = weighTargetCandidates(structuralPool, ranks, excludeSet);
    const picked = pickWeightedTarget(weighted, rng);
    if (!picked) return { ok: false, code: "pool_empty" };
    tried.add(picked.id);

    const playerRow = await loadFullPlayer(supabase, picked.id);
    if (!playerRow) continue;

    const statsBundle = await loadStatsBundle(supabase, picked.id);
    const facts = await assembleClueFacts(supabase, playerRow, statsBundle);
    const rawCandidates = generateClueCandidates(facts);
    const candidates = applyDisabledKeys(rawCandidates, settings.clues.disabled_clue_keys);
    const coverage = computeClueCoverage(candidates);

    const structuralEntry = structuralById.get(picked.id);
    if (!structuralEntry) continue;
    const evalResult = evaluatePlayerEligibility({ ...structuralEntry, clueCoverage: coverage });
    if (!evalResult.eligible) continue;

    const starters = selectStarterClues(candidates, settings.clues, rng);
    return { ok: true, player: playerRow, candidates, starters };
  }

  return { ok: false, code: "pool_empty" };
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type BadRead = { playerId: string; name: string; position: string; team: string | null };

export type RevealedClueOut = {
  clueKey: string;
  tier: string;
  label: string;
  displayValue: string;
  revealOrder: number | null;
};

export type SignalScoutStreaks = {
  currentSignalStreak: number;
  bestSignalStreak: number;
  currentDailyStreak: number;
  bestDailyStreak: number;
};

/**
 * ANTI-CHEAT INVARIANT (plan section 15): ActiveRoundDto must NEVER contain
 * target_player_id, the target's name/team/position, settings_snapshot, any
 * unrevealed clue's key/label/displayValue, or any clue's specificity value.
 * Only is_revealed=true clue rows ever become a RevealedClueOut; every other
 * field here is either a plain count/number or an already-public identifier
 * (the round id) or the viewer's OWN streak counters, which are not
 * target-adjacent secrets. This is enforced structurally (there is no field
 * on this type that could carry the target or a locked clue's content) and
 * is covered by a serialization test in round-engine.test.ts.
 */
export type ActiveRoundDto = {
  roundId: string;
  score: number;
  wrongGuesses: number;
  maxWrongGuesses: number;
  burned: boolean;
  revealedClues: RevealedClueOut[];
  lockedCounts: Record<SignalTierKey, number>;
  purchasesRemaining: Record<SignalTierKey, number>;
  tierCosts: Record<SignalTierKey, number>;
  badReads: BadRead[];
  guest: boolean;
  /**
   * Streak context (plan sections 3 and 12 list streaks among the allowed
   * pre-completion payload fields). Present only for logged-in rounds with
   * an existing signal_scout_user_stats row; absent for guests (plan
   * section 6: guest streaks are session-scoped and rendered client-side,
   * never persisted or read from the DB) and absent for a logged-in user's
   * very first round (no stats row yet).
   */
  streaks?: SignalScoutStreaks;
};

export type CompletedStatus = "won" | "solved_late" | "failed" | "skipped";

export type CompletedRoundDto = ActiveRoundDto & {
  status: CompletedStatus;
  scoreAwarded: number;
  target: { playerId: string; name: string; position: string; team: string | null; sleeperId: string | null };
  /** The full clue sheet, including clues that were never purchased/revealed pre-completion. */
  allClues: RevealedClueOut[];
};

const SIGNAL_TIER_KEYS: SignalTierKey[] = ["weak", "clear", "ping", "scan"];

function isSignalTierKey(tier: string): tier is SignalTierKey {
  return tier === "weak" || tier === "clear" || tier === "ping" || tier === "scan";
}

export function computeLockedCounts(clueRows: ClueRow[]): Record<SignalTierKey, number> {
  const counts: Record<SignalTierKey, number> = { weak: 0, clear: 0, ping: 0, scan: 0 };
  for (const row of clueRows) {
    if (!row.is_revealed && isSignalTierKey(row.tier)) counts[row.tier] += 1;
  }
  return counts;
}

export function computePurchasesRemaining(
  tierLimits: ClueTierLimits,
  tierPurchases: Record<string, number>,
): Record<SignalTierKey, number> {
  const out = {} as Record<SignalTierKey, number>;
  for (const tier of SIGNAL_TIER_KEYS) {
    out[tier] = Math.max(0, tierLimits[tier] - (tierPurchases[tier] ?? 0));
  }
  return out;
}

export function computeTierCosts(scoring: ScoringSettings): Record<SignalTierKey, number> {
  const out = {} as Record<SignalTierKey, number>;
  for (const tier of SIGNAL_TIER_KEYS) out[tier] = tierCost(scoring, tier);
  return out;
}

/** A tier is disabled when every one of its clue keys is in the round's frozen disabled_clue_keys snapshot. */
export function isTierDisabled(tier: SignalTierKey, disabledKeys: string[]): boolean {
  const tierKeys = CLUE_DEFINITIONS.filter((d) => d.tier === tier).map((d) => d.key);
  if (tierKeys.length === 0) return false;
  const disabled = new Set(disabledKeys);
  return tierKeys.every((key) => disabled.has(key));
}

function toRevealedClueOut(row: ClueRow): RevealedClueOut {
  return { clueKey: row.clue_key, tier: row.tier, label: row.label, displayValue: row.display_value, revealOrder: row.reveal_order };
}

function sortByRevealOrder(rows: ClueRow[]): ClueRow[] {
  return [...rows].sort((a, b) => (a.reveal_order ?? 0) - (b.reveal_order ?? 0));
}

type PlayerReveal = { id: string; name: string; position: string; team: string | null; sleeperId: string | null };

function extractSleeperId(externalIds: unknown): string | null {
  if (externalIds && typeof externalIds === "object") {
    const v = (externalIds as Record<string, unknown>).sleeper;
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function toPlayerReveal(row: {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string | null;
  position: string;
  team: string | null;
  external_ids: unknown;
}): PlayerReveal {
  return {
    id: row.id,
    name: row.full_name ?? `${row.first_name} ${row.last_name}`.trim(),
    position: row.position,
    team: row.team,
    sleeperId: extractSleeperId(row.external_ids),
  };
}

async function loadPlayerReveal(supabase: Client, playerId: string): Promise<PlayerReveal | null> {
  const { data, error } = await supabase
    .from("players")
    .select("id, first_name, last_name, full_name, position, team, external_ids")
    .eq("id", playerId)
    .maybeSingle();
  if (error) throw error;
  return data ? toPlayerReveal(data) : null;
}

async function loadPlayerRevealsByIds(supabase: Client, ids: string[]): Promise<Map<string, PlayerReveal>> {
  const map = new Map<string, PlayerReveal>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from("players")
    .select("id, first_name, last_name, full_name, position, team, external_ids")
    .in("id", ids);
  if (error) throw error;
  for (const row of data ?? []) map.set(row.id, toPlayerReveal(row));
  return map;
}

/**
 * Bad Reads list: wrong guesses joined to players for name/position/team
 * display. Implemented as two queries (guesses, then a batched players
 * lookup) rather than a single embedded-relation select, trading the plan's
 * literal "one query" for straightforward typing and a mock-friendly shape;
 * query count is still O(1) regardless of how many wrong guesses exist.
 */
async function loadBadReads(supabase: Client, roundId: string): Promise<BadRead[]> {
  const { data, error } = await supabase
    .from("signal_scout_guesses")
    .select("guessed_player_id, guess_number")
    .eq("round_id", roundId)
    .eq("is_correct", false)
    .order("guess_number", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const playerMap = await loadPlayerRevealsByIds(
    supabase,
    rows.map((r) => r.guessed_player_id),
  );
  return rows.map((r) => {
    const p = playerMap.get(r.guessed_player_id);
    return {
      playerId: r.guessed_player_id,
      name: p?.name ?? "Unknown player",
      position: p?.position ?? "",
      team: p?.team ?? null,
    };
  });
}

/**
 * Streak context for a round's owner. Undefined for guests (no persisted
 * streaks, plan section 6) and for a logged-in user with no
 * signal_scout_user_stats row yet (their first round). Shared by both DTO
 * builders so the query and shaping logic live in exactly one place:
 * buildCompletedDto always runs AFTER applyStatsAndStreaks in every call
 * path (submitGuess, skipRound), so the values read here are the freshly
 * updated post-completion streaks; for a still-active round they are simply
 * the current pre-round values, which is the correct thing to show as
 * "streak context" alongside a live round.
 */
async function loadStreaksForRound(supabase: Client, round: RoundRow): Promise<SignalScoutStreaks | undefined> {
  if (!round.user_id) return undefined;
  const { data: statsRow, error } = await supabase
    .from("signal_scout_user_stats")
    .select("current_signal_streak, best_signal_streak, current_daily_streak, best_daily_streak")
    .eq("user_id", round.user_id)
    .maybeSingle();
  if (error) throw error;
  if (!statsRow) return undefined;
  return {
    currentSignalStreak: statsRow.current_signal_streak,
    bestSignalStreak: statsRow.best_signal_streak,
    currentDailyStreak: statsRow.current_daily_streak,
    bestDailyStreak: statsRow.best_daily_streak,
  };
}

async function buildActiveDto(
  supabase: Client,
  round: RoundRow,
  clueRows: ClueRow[],
  badReadsOverride?: BadRead[],
): Promise<ActiveRoundDto> {
  const snapshot = parseSettingsSnapshot(round.settings_snapshot);
  const revealed = sortByRevealOrder(clueRows.filter((r) => r.is_revealed)).map(toRevealedClueOut);
  const badReads = badReadsOverride ?? (await loadBadReads(supabase, round.id));
  const streaks = await loadStreaksForRound(supabase, round);

  return {
    roundId: round.id,
    score: round.score_available,
    wrongGuesses: round.wrong_guess_count,
    maxWrongGuesses: snapshot.scoring.max_wrong_guesses,
    burned: round.burned_out_at !== null,
    revealedClues: revealed,
    lockedCounts: computeLockedCounts(clueRows),
    purchasesRemaining: computePurchasesRemaining(
      snapshot.clues.tier_limits,
      (round.tier_purchases as Record<string, number> | null) ?? {},
    ),
    tierCosts: computeTierCosts(snapshot.scoring),
    badReads,
    guest: round.user_id === null,
    streaks,
  };
}

async function buildCompletedDto(supabase: Client, round: RoundRow, clueRows: ClueRow[]): Promise<CompletedRoundDto> {
  // buildActiveDto already loads streaks (see loadStreaksForRound's doc
  // comment); reused here rather than querying signal_scout_user_stats a
  // second time.
  const base = await buildActiveDto(supabase, round, clueRows);
  const targetReveal = await loadPlayerReveal(supabase, round.target_player_id);
  const allClues = sortByRevealOrder(clueRows).map(toRevealedClueOut);

  return {
    ...base,
    status: round.status as CompletedStatus,
    scoreAwarded: round.score_awarded,
    target: targetReveal
      ? { playerId: targetReveal.id, name: targetReveal.name, position: targetReveal.position, team: targetReveal.team, sleeperId: targetReveal.sleeperId }
      : { playerId: round.target_player_id, name: "Unknown player", position: "", team: null, sleeperId: null },
    allClues,
  };
}

// ---------------------------------------------------------------------------
// Stats and streaks persistence
// ---------------------------------------------------------------------------

/**
 * Applies a completed round's outcome to signal_scout_user_stats and
 * signal_scout_daily_scores. Guests skip entirely: no persisted streaks or
 * stats. `round` must be the POST-transition row (the value returned from
 * completeRoundTransition), since hints_used/wrong_guess_count/burned_out_at
 * are read from it for the counter increments.
 *
 * DATE NOTE: round.game_date is the ET calendar day the round STARTED on; it
 * is frozen at startRound and correctly keys the guest daily-round-cap
 * lookup and is left untouched here. Streaks and daily-score credit, by
 * contrast, must reflect the day the round was COMPLETED (a round started
 * at 11:58 PM ET and finished at 12:02 AM ET the next day should credit the
 * new day, not the old one), so this function computes its own
 * completionDate rather than reusing round.game_date.
 */
async function applyStatsAndStreaks(
  supabase: Client,
  identity: RoundIdentity,
  round: RoundRow,
  outcome: RoundOutcome,
  scoreAwarded: number,
): Promise<void> {
  if (identity.kind !== "user") return;
  const userId = identity.userId;
  const now = nowIso();
  const completionDate = currentEasternGameDate();

  const { data: existingStats, error: statsError } = await supabase
    .from("signal_scout_user_stats")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (statsError) throw statsError;

  const currentStreakState: StreakState = existingStats
    ? {
        currentSignalStreak: existingStats.current_signal_streak,
        bestSignalStreak: existingStats.best_signal_streak,
        currentDailyStreak: existingStats.current_daily_streak,
        bestDailyStreak: existingStats.best_daily_streak,
        lastPlayedDate: existingStats.last_played_date,
      }
    : { currentSignalStreak: 0, bestSignalStreak: 0, currentDailyStreak: 0, bestDailyStreak: 0, lastPlayedDate: null };

  const nextStreaks = applyRoundOutcomeToStreaks({ outcome, gameDate: completionDate, current: currentStreakState });
  const wasBurned = round.burned_out_at !== null;

  const statsPayload: Database["public"]["Tables"]["signal_scout_user_stats"]["Insert"] = {
    user_id: userId,
    rounds_played: (existingStats?.rounds_played ?? 0) + 1,
    rounds_won: (existingStats?.rounds_won ?? 0) + (outcome === "won" ? 1 : 0),
    rounds_solved_late: (existingStats?.rounds_solved_late ?? 0) + (outcome === "solved_late" ? 1 : 0),
    rounds_failed: (existingStats?.rounds_failed ?? 0) + (outcome === "failed" ? 1 : 0),
    rounds_skipped: (existingStats?.rounds_skipped ?? 0) + (outcome === "skipped" ? 1 : 0),
    rounds_burned: (existingStats?.rounds_burned ?? 0) + (wasBurned ? 1 : 0),
    total_hints: (existingStats?.total_hints ?? 0) + round.hints_used,
    total_wrong_guesses: (existingStats?.total_wrong_guesses ?? 0) + round.wrong_guess_count,
    total_points: (existingStats?.total_points ?? 0) + scoreAwarded,
    current_signal_streak: nextStreaks.currentSignalStreak,
    best_signal_streak: nextStreaks.bestSignalStreak,
    current_daily_streak: nextStreaks.currentDailyStreak,
    best_daily_streak: nextStreaks.bestDailyStreak,
    last_played_date: nextStreaks.lastPlayedDate,
    // Set only on first insert; an existing row keeps its original value.
    first_played_at: existingStats?.first_played_at ?? now,
    updated_at: now,
  };
  const { error: upsertStatsError } = await supabase
    .from("signal_scout_user_stats")
    .upsert(statsPayload, { onConflict: "user_id" });
  if (upsertStatsError) throw upsertStatsError;

  const { data: existingDaily, error: dailyError } = await supabase
    .from("signal_scout_daily_scores")
    .select("*")
    .eq("user_id", userId)
    .eq("game_date", completionDate)
    .maybeSingle();
  if (dailyError) throw dailyError;

  const dailyPayload: Database["public"]["Tables"]["signal_scout_daily_scores"]["Insert"] = {
    user_id: userId,
    game_date: completionDate,
    points: (existingDaily?.points ?? 0) + scoreAwarded,
    rounds: (existingDaily?.rounds ?? 0) + 1,
    wins: (existingDaily?.wins ?? 0) + (outcome === "won" ? 1 : 0),
    // Set only on the first round of the day; an existing row keeps its original value.
    first_play_at: existingDaily?.first_play_at ?? now,
  };
  const { error: upsertDailyError } = await supabase
    .from("signal_scout_daily_scores")
    .upsert(dailyPayload, { onConflict: "user_id,game_date" });
  if (upsertDailyError) throw upsertDailyError;
}

// ---------------------------------------------------------------------------
// startRound
// ---------------------------------------------------------------------------

export type StartRoundResult =
  | { ok: true; round: ActiveRoundDto }
  | { ok: false; code: "game_disabled" | "pool_empty" }
  | { ok: false; code: "active_round_exists"; existingRoundId: string };

export async function startRound(
  supabase: Client,
  identity: RoundIdentity,
  opts?: { rng?: () => number },
): Promise<StartRoundResult> {
  const rng = opts?.rng ?? Math.random;
  const settings = await loadSignalScoutSettings(supabase);
  if (!settings.game_enabled) return { ok: false, code: "game_disabled" };

  const existingActive = await findActiveRound(supabase, identity);
  if (existingActive) return { ok: false, code: "active_round_exists", existingRoundId: existingActive.id };

  const selection = await selectTarget(supabase, identity, settings, rng);
  if (!selection.ok) return { ok: false, code: "pool_empty" };

  const roundInsert: Database["public"]["Tables"]["signal_scout_rounds"]["Insert"] = {
    user_id: identity.kind === "user" ? identity.userId : null,
    guest_id: identity.kind === "guest" ? identity.guestId : null,
    ip_hash: identity.kind === "guest" ? identity.ipHash : null,
    target_player_id: selection.player.id,
    score_available: settings.scoring.starting_score,
    settings_snapshot: settings as unknown as Json,
    game_date: currentEasternGameDate(),
  };

  const { data: insertedRound, error: insertError } = await supabase
    .from("signal_scout_rounds")
    .insert(roundInsert)
    .select()
    .single();

  if (insertError) {
    // The partial unique active-round index rejects a concurrent double-click;
    // resolve it to the winning round rather than surfacing a raw DB error.
    if ((insertError as { code?: string }).code === "23505") {
      const existing = await findActiveRound(supabase, identity);
      return { ok: false, code: "active_round_exists", existingRoundId: existing?.id ?? "" };
    }
    throw insertError;
  }

  const starterKeys = new Set(selection.starters.map((c) => c.clueKey));
  const clueRowsToInsert: Database["public"]["Tables"]["signal_scout_round_clues"]["Insert"][] = [];

  selection.starters.forEach((c, idx) => {
    clueRowsToInsert.push({
      round_id: insertedRound.id,
      clue_key: c.clueKey,
      tier: "starter",
      label: c.label,
      display_value: c.displayValue,
      specificity: c.specificity,
      cost: 0,
      is_revealed: true,
      reveal_order: idx + 1,
      revealed_at: nowIso(),
    });
  });

  selection.candidates
    .filter((c) => !starterKeys.has(c.clueKey))
    .forEach((c) => {
      clueRowsToInsert.push({
        round_id: insertedRound.id,
        clue_key: c.clueKey,
        tier: c.tier,
        label: c.label,
        display_value: c.displayValue,
        specificity: c.specificity,
        cost: tierCost(settings.scoring, c.tier),
        is_revealed: false,
        reveal_order: null,
        revealed_at: null,
      });
    });

  if (clueRowsToInsert.length > 0) {
    const { error: clueInsertError } = await supabase.from("signal_scout_round_clues").insert(clueRowsToInsert);
    if (clueInsertError) throw clueInsertError;
  }

  const dto = await buildActiveDto(supabase, insertedRound, clueRowsToInsert as unknown as ClueRow[], []);
  return { ok: true, round: dto };
}

// ---------------------------------------------------------------------------
// purchaseHint
// ---------------------------------------------------------------------------

export type PurchaseHintSuccess = {
  clue: RevealedClueOut;
  scoreAvailable: number;
  burned: boolean;
  hintsUsed: number;
  tierPurchasesRemaining: Record<SignalTierKey, number>;
  lockedCounts: Record<SignalTierKey, number>;
};

export type PurchaseHintResult = ({ ok: true } & PurchaseHintSuccess) | { ok: false; code: EngineError };

export async function purchaseHint(
  supabase: Client,
  identity: RoundIdentity,
  roundId: string,
  tier: SignalTierKey,
  confirmBurn: boolean,
  opts?: { rng?: () => number },
): Promise<PurchaseHintResult> {
  // Defense in depth: Phase 3 routes must still zod-validate tier before
  // calling in, but the engine does not rely on that. tier is typed as
  // SignalTierKey, but TypeScript types are erased at runtime and Phase 3
  // takes this value from client input, so an out-of-enum string can reach
  // here. Without this guard, tierLimits[tier] and tierCost() both return
  // undefined: the burn gate (cost >= scoreAvailable) evaluates false
  // (undefined >= number is false), and clamp0(scoreAvailable - undefined)
  // computes NaN, which would be persisted into score_available. Every
  // subsequent guard/comparison against a NaN score_available is false,
  // permanently corrupting that round's economy (hints become free forever).
  if (!isSignalTierKey(tier)) return { ok: false, code: "invalid_tier" };

  const rng = opts?.rng ?? Math.random;

  const round = await fetchOwnedRound(supabase, identity, roundId);
  if (!round) return { ok: false, code: "not_found" };
  if (round.status !== "active") return { ok: false, code: "round_not_active" };

  const snapshot = parseSettingsSnapshot(round.settings_snapshot);
  if (isTierDisabled(tier, snapshot.clues.disabled_clue_keys)) {
    return { ok: false, code: "tier_disabled" };
  }

  const clueRows = await fetchRoundClues(supabase, roundId);
  const tierRows = clueRows.filter((r) => r.tier === tier);
  const unrevealedInTier = tierRows.filter((r) => !r.is_revealed).length;
  const tierPurchases = (round.tier_purchases as Record<string, number> | null) ?? {};
  const purchasesUsedInTier = tierPurchases[tier] ?? 0;

  const evalResult = evaluateHintPurchase({
    scoreAvailable: round.score_available,
    tier,
    scoring: snapshot.scoring,
    tierLimits: snapshot.clues.tier_limits,
    purchasesUsedInTier,
    unrevealedInTier,
    confirmBurn,
  });
  if (!evalResult.ok) return { ok: false, code: evalResult.code };

  const newTierPurchases = { ...tierPurchases, [tier]: purchasesUsedInTier + 1 };
  const newHintsUsed = round.hints_used + 1;
  const burnedOutAt = evalResult.burned && !round.burned_out_at ? nowIso() : round.burned_out_at;

  // Anchor write: deduct score, advance counters. Guarded on status=active
  // and the priorScore we read above.
  const updated = await guardedActiveUpdate(supabase, round, {
    score_available: evalResult.newScore,
    hints_used: newHintsUsed,
    tier_purchases: newTierPurchases as unknown as Json,
    burned_out_at: burnedOutAt,
  });
  if (!updated) return { ok: false, code: "round_not_active" };

  // Secondary write: reveal exactly one unrevealed clue of this tier.
  const unrevealedCandidates = tierRows.filter((r) => !r.is_revealed);
  const chosen = unrevealedCandidates[Math.min(unrevealedCandidates.length - 1, Math.floor(rng() * unrevealedCandidates.length))];
  const revealedCount = clueRows.filter((r) => r.is_revealed).length;
  const revealOrder = revealedCount + 1;
  const revealedAt = nowIso();

  const { data: revealedRow, error: revealError } = await supabase
    .from("signal_scout_round_clues")
    .update({ is_revealed: true, reveal_order: revealOrder, revealed_at: revealedAt })
    .eq("round_id", roundId)
    .eq("clue_key", chosen.clue_key)
    .eq("is_revealed", false)
    .select()
    .maybeSingle();
  if (revealError) throw revealError;
  if (!revealedRow) {
    // Extremely rare race on the clue row itself, after the round-level
    // guard already committed the deduction. Not retried (see the
    // module header's consistency model); surfaced as round_not_active.
    return { ok: false, code: "round_not_active" };
  }

  const updatedClueRows = clueRows.map((r) =>
    r.clue_key === chosen.clue_key ? { ...r, is_revealed: true, reveal_order: revealOrder, revealed_at: revealedAt } : r,
  );

  return {
    ok: true,
    clue: toRevealedClueOut(revealedRow),
    scoreAvailable: evalResult.newScore,
    burned: evalResult.newScore === 0,
    hintsUsed: newHintsUsed,
    tierPurchasesRemaining: computePurchasesRemaining(snapshot.clues.tier_limits, newTierPurchases),
    lockedCounts: computeLockedCounts(updatedClueRows),
  };
}

// ---------------------------------------------------------------------------
// submitGuess
// ---------------------------------------------------------------------------

/** Mirrors RANKINGS_WINDOW_DAYS in eligibility.ts (not exported there); a guessed player must be a live pool member. */
const RANKINGS_WINDOW_DAYS = 90;

async function isInRankingsWindow(supabase: Client, playerId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - RANKINGS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("rankings")
    .select("player_id")
    .eq("player_id", playerId)
    .gte("generated_at", cutoff)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

async function insertGuess(
  supabase: Client,
  roundId: string,
  guessedPlayerId: string,
  isCorrect: boolean,
  guessNumber: number,
): Promise<void> {
  const { error } = await supabase.from("signal_scout_guesses").insert({
    round_id: roundId,
    guessed_player_id: guessedPlayerId,
    is_correct: isCorrect,
    guess_number: guessNumber,
  });
  if (error) throw error;
}

export type SubmitGuessResult = { ok: true; round: ActiveRoundDto | CompletedRoundDto } | { ok: false; code: EngineError };

export async function submitGuess(
  supabase: Client,
  identity: RoundIdentity,
  roundId: string,
  guessedPlayerId: string,
): Promise<SubmitGuessResult> {
  const round = await fetchOwnedRound(supabase, identity, roundId);
  if (!round) return { ok: false, code: "not_found" };
  if (round.status !== "active") return { ok: false, code: "round_not_active" };

  const { data: guessRows, error: guessesError } = await supabase
    .from("signal_scout_guesses")
    .select("guessed_player_id, guess_number")
    .eq("round_id", roundId);
  if (guessesError) throw guessesError;
  const existingGuesses = guessRows ?? [];
  if (existingGuesses.some((g) => g.guessed_player_id === guessedPlayerId)) {
    return { ok: false, code: "guess_duplicate" };
  }
  const guessNumber = existingGuesses.length + 1;

  const snapshot = parseSettingsSnapshot(round.settings_snapshot);
  const playerReveal = (await loadPlayerRevealsByIds(supabase, [guessedPlayerId])).get(guessedPlayerId);
  if (!playerReveal || !(snapshot.pool.eligible_positions as string[]).includes(playerReveal.position)) {
    return { ok: false, code: "guess_out_of_pool" };
  }
  if (!(await isInRankingsWindow(supabase, guessedPlayerId))) {
    return { ok: false, code: "guess_out_of_pool" };
  }

  const isCorrect = guessedPlayerId === round.target_player_id;

  if (!isCorrect) {
    const wrongResult = applyWrongGuess({
      scoreAvailable: round.score_available,
      wrongGuessCount: round.wrong_guess_count,
      scoring: snapshot.scoring,
    });
    const burnedOutAt = wrongResult.burned && !round.burned_out_at ? nowIso() : round.burned_out_at;

    if (wrongResult.failed) {
      const updated = await completeRoundTransition(supabase, round, {
        status: "failed",
        scoreAwarded: 0,
        scoreAvailable: wrongResult.newScore,
        wrongGuessCount: wrongResult.newWrongGuessCount,
        burnedOutAt,
      });
      if (!updated) return { ok: false, code: "round_not_active" };
      await insertGuess(supabase, roundId, guessedPlayerId, false, guessNumber);
      await applyStatsAndStreaks(supabase, identity, updated, "failed", 0);
      const clueRows = await fetchRoundClues(supabase, roundId);
      return { ok: true, round: await buildCompletedDto(supabase, updated, clueRows) };
    }

    const updated = await guardedActiveUpdate(supabase, round, {
      score_available: wrongResult.newScore,
      wrong_guess_count: wrongResult.newWrongGuessCount,
      burned_out_at: burnedOutAt,
    });
    if (!updated) return { ok: false, code: "round_not_active" };
    await insertGuess(supabase, roundId, guessedPlayerId, false, guessNumber);
    const clueRows = await fetchRoundClues(supabase, roundId);
    return { ok: true, round: await buildActiveDto(supabase, updated, clueRows) };
  }

  const correctResult = resolveCorrectGuess(round.score_available);
  const updated = await completeRoundTransition(supabase, round, {
    status: correctResult.outcome,
    scoreAwarded: correctResult.scoreAwarded,
    scoreAvailable: round.score_available,
    wrongGuessCount: round.wrong_guess_count,
    burnedOutAt: round.burned_out_at,
  });
  if (!updated) return { ok: false, code: "round_not_active" };
  await insertGuess(supabase, roundId, guessedPlayerId, true, guessNumber);
  await applyStatsAndStreaks(supabase, identity, updated, correctResult.outcome, correctResult.scoreAwarded);
  const clueRows = await fetchRoundClues(supabase, roundId);
  return { ok: true, round: await buildCompletedDto(supabase, updated, clueRows) };
}

// ---------------------------------------------------------------------------
// skipRound
// ---------------------------------------------------------------------------

export type SkipRoundResult = { ok: true; round: CompletedRoundDto } | { ok: false; code: EngineError };

export async function skipRound(supabase: Client, identity: RoundIdentity, roundId: string): Promise<SkipRoundResult> {
  const round = await fetchOwnedRound(supabase, identity, roundId);
  if (!round) return { ok: false, code: "not_found" };
  if (round.status !== "active") return { ok: false, code: "round_not_active" };

  const updated = await completeRoundTransition(supabase, round, {
    status: "skipped",
    scoreAwarded: 0,
    scoreAvailable: round.score_available,
    wrongGuessCount: round.wrong_guess_count,
    burnedOutAt: round.burned_out_at,
  });
  if (!updated) return { ok: false, code: "round_not_active" };

  await applyStatsAndStreaks(supabase, identity, updated, "skipped", 0);
  const clueRows = await fetchRoundClues(supabase, roundId);
  return { ok: true, round: await buildCompletedDto(supabase, updated, clueRows) };
}

// ---------------------------------------------------------------------------
// getRound
// ---------------------------------------------------------------------------

export type GetRoundResult = { ok: true; round: ActiveRoundDto | CompletedRoundDto } | { ok: false; code: "not_found" };

export async function getRound(supabase: Client, identity: RoundIdentity, roundId: string): Promise<GetRoundResult> {
  const round = await fetchOwnedRound(supabase, identity, roundId);
  if (!round) return { ok: false, code: "not_found" };

  const clueRows = await fetchRoundClues(supabase, roundId);
  if (round.status === "active") {
    return { ok: true, round: await buildActiveDto(supabase, round, clueRows) };
  }
  return { ok: true, round: await buildCompletedDto(supabase, round, clueRows) };
}
