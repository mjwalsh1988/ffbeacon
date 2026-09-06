/**
 * Every database read Manager Pulse makes. The only module in this feature
 * that touches Supabase.
 *
 * NEVER THROWS. A read that fails is logged with console.warn and contributes
 * an empty array (or a field's honest null), never a thrown error that takes
 * the whole report down with it.
 *
 * NEVER SELECT *. Every query below names its columns, because two of the
 * tables this reads (`manager_pulse_cache.report`, `league_matchups.player_points`)
 * are large and this module has no use for most of either.
 *
 * NEVER TRIGGERS A COMPUTE. This reads `league_manager_ledger_cache` as it
 * finds it. A league-season with no row is absent from `ledgers`, full stop.
 *
 * PAGES EVERYTHING. PostgREST truncates a plain `select()` at 1000 rows with
 * no error, so every read that can plausibly return more than that pages with
 * `.range()`, and every `.in()` filter is chunked at 200 ids, matching the
 * rest of the codebase's convention for exactly this bug.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  categorizeLeague,
  type LeagueCategoryKey,
} from "@/lib/league-category";
import {
  bracketChampion,
  mapLimit,
  type SleeperBracketMatch,
  type SleeperLeague,
} from "@/lib/sleeper";
import { deriveLeagueFormat, mapToFormatSlug } from "@/lib/sleeper-to-format";
import { classifyDraftPool } from "@/lib/startup-draft";
import { readTradePosition } from "@/lib/trade-finder/types";
import {
  analyzeLeagueTrades,
  type LeagueTradeInput,
} from "@/lib/league-signal-check";
import type { SideKey } from "@/lib/signal-check/types";
import { resolveSourceForFormat, type SourceRegistryRow } from "@/lib/source";
import type {
  ManagerDraftFacts,
  ManagerDraftPick,
  ManagerLedgerFacts,
  ManagerLeagueSeason,
  ManagerMove,
  ManagerMoveKind,
  ManagerPickObservation,
  ManagerPlayerFacts,
  ManagerPulseInput,
  ManagerTrade,
  ManagerWeeklyMoves,
} from "./input-types";
import type { ManagerLeagueCategory, ManagerPulseSettings } from "./types";

type Client = SupabaseClient<Database>;

/** PostgREST's silent truncation point. Every multi-row read pages past it. */
const PAGE = 1000;
/** How many ids go into one `.in()` filter, matching the rest of the codebase. */
const CHUNK = 200;

/**
 * League-seasons graded at once by `analyzeLeagueTrades`.
 *
 * Four rather than one because the calls are independent and mostly latency;
 * four rather than forty because each one is a dozen queries and the point is
 * to shorten the wall clock, not to hand the connection pool a thundering herd.
 */
const TRADE_GRADE_CONCURRENCY = 4;

/**
 * The two format slugs Manager Pulse prices players against. Pinned rather
 * than derived per league, because a report has to compare a value across
 * many league-seasons of possibly-different exact formats, and consistency
 * across the report matters more than which two formats were chosen.
 *
 * dynasty-ppr-sflex: the dynasty market's most-published board (superflex is
 * the dominant dynasty shape this product prices).
 * redraft-ppr-std: lib/site.ts DEFAULT_FORMAT_SLUG, the site's own redraft
 * default, so a redraft figure here matches what a reader sees everywhere
 * else on the site with no source/format selected.
 */
const DYNASTY_MARKET_FORMAT_SLUG = "dynasty-ppr-sflex";
const REDRAFT_MARKET_FORMAT_SLUG = "redraft-ppr-std";

function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function warn(where: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[manager-pulse/load] ${where}: ${message}`);
}

function asStringArray(value: Json | null | undefined): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function asNumberArray(value: Json | null | undefined): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => Number(v)).filter((n) => Number.isFinite(n));
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Sleeper's adds/drops shape: player id (string) to receiving roster id. */
function rosterMap(value: Json | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [playerId, raw] of Object.entries(value as Record<string, unknown>)) {
    const rosterId = Number(raw);
    if (Number.isFinite(rosterId)) out[playerId] = rosterId;
  }
  return out;
}

/**
 * Whole years from a birth date to report time. THE ONE PLACE A CLOCK IS
 * ALLOWED in this feature: the pure engine and everything under it is
 * clock-free by rule, so age is resolved to a plain number here and carried
 * as data from that point on.
 */
function ageFromBirthDate(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const hadBirthdayThisYear =
    now.getUTCMonth() > birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * Rank every roster by a numeric value, descending, 1 = highest. Ties share
 * the better (lower) rank; the next distinct value skips ahead by the tie
 * size (standard competition ranking), matching the points-for convention
 * `ManagerLeagueSeason.pointsForRankByRoster` documents.
 */
function rankDescending(entries: Array<{ rosterId: number; value: number }>): Record<number, number> {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const out: Record<number, number> = {};
  let rank = 0;
  let seen = 0;
  let prevValue: number | null = null;
  for (const { rosterId, value } of sorted) {
    seen += 1;
    if (prevValue === null || value !== prevValue) rank = seen;
    out[rosterId] = rank;
    prevValue = value;
  }
  return out;
}

/** Sleeper's traded-pick object as stored on a transaction. */
type TradedPickEntry = {
  season?: unknown;
  round?: unknown;
  roster_id?: unknown;
  previous_owner_id?: unknown;
  owner_id?: unknown;
};

function normalizePicks(value: Json | null | undefined): TradedPickEntry[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as unknown as TradedPickEntry[];
  if (typeof value === "object") return Object.values(value as Record<string, unknown>) as TradedPickEntry[];
  return [];
}

/** Distinct roster ids on either side of a trade, ascending. Mirrors the
 * private `tradeRosters` in lib/league-signal-check.ts so this module's own
 * side assignment can never disagree with the one that produced the grade. */
function tradeRosterOrder(adds: Record<string, number>, picks: TradedPickEntry[]): number[] {
  const set = new Set<number>();
  for (const rid of Object.values(adds)) set.add(Number(rid));
  for (const p of picks) {
    const owner = p.owner_id;
    if (owner != null) set.add(Number(owner));
  }
  return Array.from(set)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

/* -------------------------------------------------------------------------- */
/* Raw row shapes                                                             */
/* -------------------------------------------------------------------------- */

type LeagueRow = {
  id: string;
  sleeper_league_id: string;
  season: number;
  name: string;
  status: string | null;
  total_rosters: number | null;
  roster_positions: Json;
  metadata: Json;
};

type RosterRow = {
  league_id: string;
  sleeper_roster_id: number;
  owner_user_id: string | null;
  co_owners: Json;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
};

/* -------------------------------------------------------------------------- */
/* Phase 0: league rows                                                      */
/* -------------------------------------------------------------------------- */

async function fetchLeagueRows(
  admin: Client,
  sleeperLeagueIds: string[],
): Promise<Map<string, LeagueRow>> {
  const out = new Map<string, LeagueRow>();
  try {
    for (const idChunk of chunk(sleeperLeagueIds)) {
      if (idChunk.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("leagues")
          .select(
            "id, sleeper_league_id, season, name, status, total_rosters, roster_positions, metadata",
          )
          .in("sleeper_league_id", idChunk)
          .range(from, from + PAGE - 1);
        if (error) {
          warn("fetchLeagueRows", error);
          break;
        }
        if (!data || data.length === 0) break;
        for (const row of data) out.set(row.sleeper_league_id, row as LeagueRow);
        if (data.length < PAGE) break;
      }
    }
  } catch (err) {
    warn("fetchLeagueRows", err);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Phase 1: rosters, per league-season                                       */
/* -------------------------------------------------------------------------- */

async function fetchRosters(admin: Client, leagueRowIds: string[]): Promise<Map<string, RosterRow[]>> {
  const out = new Map<string, RosterRow[]>();
  try {
    for (const idChunk of chunk(leagueRowIds)) {
      if (idChunk.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("rosters")
          .select(
            "league_id, sleeper_roster_id, owner_user_id, co_owners, wins, losses, ties, points_for, points_against",
          )
          .in("league_id", idChunk)
          .range(from, from + PAGE - 1);
        if (error) {
          warn("fetchRosters", error);
          break;
        }
        if (!data || data.length === 0) break;
        for (const row of data as RosterRow[]) {
          const list = out.get(row.league_id) ?? [];
          list.push(row);
          out.set(row.league_id, list);
        }
        if (data.length < PAGE) break;
      }
    }
  } catch (err) {
    warn("fetchRosters", err);
  }
  return out;
}

function findManagerRoster(rosters: RosterRow[], sleeperUserId: string): RosterRow | null {
  for (const r of rosters) {
    if (r.owner_user_id === sleeperUserId) return r;
    const coOwners = asStringArray(r.co_owners);
    if (coOwners.includes(sleeperUserId)) return r;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* League-season assembly                                                    */
/* -------------------------------------------------------------------------- */

function faabFromMetadata(metadata: Json): { usesFaab: boolean; faabBudget: number | null } {
  const meta = (metadata ?? {}) as { settings?: Record<string, unknown> };
  const waiverType = Number(meta.settings?.waiver_type);
  const waiverBudget = Number(meta.settings?.waiver_budget);
  const hasBudget = Number.isFinite(waiverBudget) && waiverBudget > 0;
  return {
    usesFaab: waiverType === 2 || hasBudget,
    faabBudget: hasBudget ? waiverBudget : null,
  };
}

function bracketsFromMetadata(metadata: Json): {
  championRosterId: number | null;
  runnerUpRosterId: number | null;
  playoffRosterIds: number[] | null;
} {
  const meta = (metadata ?? {}) as { brackets?: { winners?: unknown } };
  const winners = meta.brackets?.winners;
  if (!Array.isArray(winners) || winners.length === 0) {
    return { championRosterId: null, runnerUpRosterId: null, playoffRosterIds: null };
  }
  const bracket = winners as SleeperBracketMatch[];
  const { championRosterId, runnerUpRosterId } = bracketChampion(bracket);
  const ids = new Set<number>();
  for (const match of bracket) {
    if (match.t1 != null) ids.add(match.t1);
    if (match.t2 != null) ids.add(match.t2);
  }
  return { championRosterId, runnerUpRosterId, playoffRosterIds: Array.from(ids) };
}

/**
 * Build the kept league-seasons: one per requested (sleeperLeagueId, season)
 * pair we hold AND can place this manager's roster in. Everything else is
 * dropped (a league we do not hold, an uncategorizable league, a league where
 * we could not find the manager's roster) with a console.warn, per the load
 * contract's "never throws, contributes what it can" rule.
 */
function buildLeagueSeasons(
  requested: Array<{
    sleeperLeagueId: string;
    season: number;
    category: ManagerLeagueCategory | null;
    leagueName: string | null;
  }>,
  leagueRows: Map<string, LeagueRow>,
  rostersByLeagueRowId: Map<string, RosterRow[]>,
  sleeperUserId: string,
): { leagueSeasons: ManagerLeagueSeason[]; leagueRowIdToSeason: Map<string, ManagerLeagueSeason> } {
  const leagueSeasons: ManagerLeagueSeason[] = [];
  const leagueRowIdToSeason = new Map<string, ManagerLeagueSeason>();

  for (const req of requested) {
    const leagueRow = leagueRows.get(req.sleeperLeagueId);
    if (!leagueRow) continue; // We do not hold this league. Skip entirely.
    if (leagueRow.season !== req.season) continue; // Defensive: should not happen by construction.

    const rawLeague = leagueRow.metadata as unknown as SleeperLeague;
    const category: LeagueCategoryKey | null =
      req.category ?? (rawLeague && typeof rawLeague === "object" ? categorizeLeague(rawLeague) : null);
    if (!category) {
      console.warn(
        `[manager-pulse/load] could not categorize league ${req.sleeperLeagueId} season ${req.season}, skipping`,
      );
      continue;
    }

    const rosters = rostersByLeagueRowId.get(leagueRow.id) ?? [];
    const managerRoster = findManagerRoster(rosters, sleeperUserId);
    if (!managerRoster) {
      // Not in this league-season, or we did not capture their roster. Skip.
      continue;
    }

    const pointsForRankByRoster = rankDescending(
      rosters.map((r) => ({ rosterId: r.sleeper_roster_id, value: Number(r.points_for) || 0 })),
    );
    const pointsAgainstRankByRoster = rankDescending(
      rosters.map((r) => ({ rosterId: r.sleeper_roster_id, value: Number(r.points_against) || 0 })),
    );

    const { usesFaab, faabBudget } = faabFromMetadata(leagueRow.metadata);
    const { championRosterId, runnerUpRosterId, playoffRosterIds } = bracketsFromMetadata(
      leagueRow.metadata,
    );
    const rosterId = managerRoster.sleeper_roster_id;
    let finish: number | null = null;
    if (championRosterId === rosterId) finish = 1;
    else if (runnerUpRosterId === rosterId) finish = 2;

    const meta = (leagueRow.metadata ?? {}) as { settings?: Record<string, unknown> };
    const sleeperLeagueType = numberOrNull(meta.settings?.type);

    const season: ManagerLeagueSeason = {
      leagueId: leagueRow.id,
      sleeperLeagueId: req.sleeperLeagueId,
      season: req.season,
      leagueName: req.leagueName ?? leagueRow.name,
      // Lifted from the raw object this function already reads, rather than
      // widening the select with a second expression for a field that is
      // sitting right here.
      avatar: typeof rawLeague?.avatar === "string" ? rawLeague.avatar : null,
      category,
      sleeperLeagueType,
      teamCount: leagueRow.total_rosters ?? rosters.length ?? null,
      rosterPositions: asStringArray(leagueRow.roster_positions),
      usesFaab,
      faabBudget,
      rosterId,
      wins: Number(managerRoster.wins) || 0,
      losses: Number(managerRoster.losses) || 0,
      ties: Number(managerRoster.ties) || 0,
      pointsFor: Number.isFinite(Number(managerRoster.points_for)) ? Number(managerRoster.points_for) : null,
      pointsAgainst: Number.isFinite(Number(managerRoster.points_against))
        ? Number(managerRoster.points_against)
        : null,
      finish,
      championRosterId,
      runnerUpRosterId,
      playoffRosterIds,
      isComplete: leagueRow.status === "complete",
      pointsForRankByRoster,
      pointsAgainstRankByRoster,
    };
    leagueSeasons.push(season);
    leagueRowIdToSeason.set(leagueRow.id, season);
  }

  // Most recent season first, matching the report's own convention.
  leagueSeasons.sort((a, b) => b.season - a.season);
  return { leagueSeasons, leagueRowIdToSeason };
}

/* -------------------------------------------------------------------------- */
/* League users (handles, and rosterLabels for Signal Check)                 */
/* -------------------------------------------------------------------------- */

async function fetchLeagueUsers(
  admin: Client,
  leagueRowIds: string[],
): Promise<Map<string, Map<string, string>>> {
  // leagueRowId -> (sleeper_user_id -> display_name)
  const out = new Map<string, Map<string, string>>();
  try {
    for (const idChunk of chunk(leagueRowIds)) {
      if (idChunk.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("league_users")
          .select("league_id, sleeper_user_id, display_name")
          .in("league_id", idChunk)
          .range(from, from + PAGE - 1);
        if (error) {
          warn("fetchLeagueUsers", error);
          break;
        }
        if (!data || data.length === 0) break;
        for (const row of data) {
          const map = out.get(row.league_id) ?? new Map<string, string>();
          if (row.display_name) map.set(row.sleeper_user_id, row.display_name);
          out.set(row.league_id, map);
        }
        if (data.length < PAGE) break;
      }
    }
  } catch (err) {
    warn("fetchLeagueUsers", err);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Phase 2: drafts                                                           */
/* -------------------------------------------------------------------------- */

type DraftRow = {
  league_id: string;
  sleeper_draft_id: string;
  season: number;
  type: string | null;
  start_time: string | null;
  settings: Json;
  metadata: Json;
};

async function fetchDrafts(admin: Client, leagueRowIds: string[]): Promise<DraftRow[]> {
  const out: DraftRow[] = [];
  try {
    for (const idChunk of chunk(leagueRowIds)) {
      if (idChunk.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("league_drafts")
          .select("league_id, sleeper_draft_id, season, type, start_time, settings, metadata")
          .in("league_id", idChunk)
          .range(from, from + PAGE - 1);
        if (error) {
          warn("fetchDrafts", error);
          break;
        }
        if (!data || data.length === 0) break;
        out.push(...(data as DraftRow[]));
        if (data.length < PAGE) break;
      }
    }
  } catch (err) {
    warn("fetchDrafts", err);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Phase 3: draft selections (picks)                                         */
/* -------------------------------------------------------------------------- */

type SelectionRow = {
  sleeper_draft_id: string;
  pick_no: number;
  round: number | null;
  roster_id: number | null;
  player_id: string | null;
  sleeper_player_id: string | null;
  is_keeper: boolean;
  player_pool: string | null;
  format_slug: string | null;
};

async function fetchSelections(admin: Client, draftIds: string[]): Promise<SelectionRow[]> {
  const out: SelectionRow[] = [];
  try {
    for (const idChunk of chunk(draftIds)) {
      if (idChunk.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("draft_selections")
          .select(
            "sleeper_draft_id, pick_no, round, roster_id, player_id, sleeper_player_id, is_keeper, player_pool, format_slug",
          )
          .in("sleeper_draft_id", idChunk)
          .range(from, from + PAGE - 1);
        if (error) {
          warn("fetchSelections", error);
          break;
        }
        if (!data || data.length === 0) break;
        out.push(...(data as SelectionRow[]));
        if (data.length < PAGE) break;
      }
    }
  } catch (err) {
    warn("fetchSelections", err);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Phase 4: draft_market_adp                                                 */
/* -------------------------------------------------------------------------- */

async function fetchMarketAdp(
  admin: Client,
  playerIds: string[],
  formatSlugs: string[],
  seasons: number[],
): Promise<Map<string, number>> {
  // key: `${format_slug}|${player_pool}|${season}|${player_id}` -> adp
  const out = new Map<string, number>();
  if (playerIds.length === 0 || formatSlugs.length === 0 || seasons.length === 0) return out;
  try {
    for (const idChunk of chunk(playerIds)) {
      if (idChunk.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("draft_market_adp")
          .select("player_id, adp, format_slug, player_pool, season")
          .in("player_id", idChunk)
          .in("format_slug", formatSlugs)
          .in("season", seasons)
          .range(from, from + PAGE - 1);
        if (error) {
          warn("fetchMarketAdp", error);
          break;
        }
        if (!data || data.length === 0) break;
        for (const row of data) {
          out.set(`${row.format_slug}|${row.player_pool}|${row.season}|${row.player_id}`, Number(row.adp));
        }
        if (data.length < PAGE) break;
      }
    }
  } catch (err) {
    warn("fetchMarketAdp", err);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Phase 5: draft_pick_observations                                          */
/* -------------------------------------------------------------------------- */

async function fetchPickObservations(admin: Client, draftIds: string[]): Promise<ManagerPickObservation[]> {
  const out: ManagerPickObservation[] = [];
  if (draftIds.length === 0) return out;
  try {
    for (const idChunk of chunk(draftIds)) {
      if (idChunk.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("draft_pick_observations")
          .select("sleeper_draft_id, pick_no, first_seen_at, observation_gap_ms, was_autopick")
          .in("sleeper_draft_id", idChunk)
          .range(from, from + PAGE - 1);
        if (error) {
          warn("fetchPickObservations", error);
          break;
        }
        if (!data || data.length === 0) break;
        for (const row of data) {
          const ms = Date.parse(row.first_seen_at);
          if (!Number.isFinite(ms)) continue;
          out.push({
            sleeperDraftId: row.sleeper_draft_id,
            pickNo: Number(row.pick_no),
            firstSeenAtMs: ms,
            observationGapMs: row.observation_gap_ms ?? null,
            wasAutopick: row.was_autopick,
          });
        }
        if (data.length < PAGE) break;
      }
    }
  } catch (err) {
    warn("fetchPickObservations", err);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Phase 6: transactions                                                     */
/* -------------------------------------------------------------------------- */

type TransactionRow = {
  league_id: string;
  sleeper_transaction_id: string;
  season: number | null;
  week: number | null;
  type: string;
  status: string | null;
  adds: Json;
  drops: Json;
  draft_picks: Json;
  roster_ids: Json;
  metadata: Json;
  created_at_sleeper: string | null;
};

async function fetchTransactions(admin: Client, leagueRowIds: string[]): Promise<TransactionRow[]> {
  const out: TransactionRow[] = [];
  try {
    for (const idChunk of chunk(leagueRowIds)) {
      if (idChunk.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("league_transactions")
          .select(
            "league_id, sleeper_transaction_id, season, week, type, status, adds, drops, draft_picks, roster_ids, metadata, created_at_sleeper",
          )
          .in("league_id", idChunk)
          .eq("status", "complete")
          .range(from, from + PAGE - 1);
        if (error) {
          warn("fetchTransactions", error);
          break;
        }
        if (!data || data.length === 0) break;
        out.push(...(data as TransactionRow[]));
        if (data.length < PAGE) break;
      }
    }
  } catch (err) {
    warn("fetchTransactions", err);
  }
  return out;
}

function touchesRoster(row: TransactionRow, rosterId: number): boolean {
  const rosterIds = asNumberArray(row.roster_ids);
  if (rosterIds.includes(rosterId)) return true;
  const adds = rosterMap(row.adds);
  const drops = rosterMap(row.drops);
  return Object.values(adds).includes(rosterId) || Object.values(drops).includes(rosterId);
}

function mapMoveKind(type: string): ManagerMoveKind {
  if (type === "waiver" || type === "free_agent" || type === "trade" || type === "commissioner") return type;
  return "commissioner";
}

/* -------------------------------------------------------------------------- */
/* Phase 7: players                                                          */
/* -------------------------------------------------------------------------- */

type PlayerRow = {
  id: string;
  full_name: string | null;
  first_name: string;
  last_name: string;
  position: string;
  birth_date: string | null;
  external_ids: Json;
  draft_year: number | null;
};

async function fetchPlayers(admin: Client, playerIds: string[]): Promise<Map<string, PlayerRow>> {
  const out = new Map<string, PlayerRow>();
  try {
    for (const idChunk of chunk(playerIds)) {
      if (idChunk.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("players")
          .select("id, full_name, first_name, last_name, position, birth_date, external_ids, draft_year")
          .in("id", idChunk)
          .range(from, from + PAGE - 1);
        if (error) {
          warn("fetchPlayers", error);
          break;
        }
        if (!data || data.length === 0) break;
        for (const row of data as PlayerRow[]) out.set(row.id, row);
        if (data.length < PAGE) break;
      }
    }
  } catch (err) {
    warn("fetchPlayers", err);
  }
  return out;
}

/** Map Sleeper player ids to our internal player ids, chunked and batched. */
async function mapSleeperPlayerIds(admin: Client, sleeperIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const numeric = Array.from(new Set(sleeperIds.filter((id) => /^\d+$/.test(id))));
  try {
    for (const idChunk of chunk(numeric)) {
      if (idChunk.length === 0) continue;
      const ors = idChunk.map((id) => `external_ids->>sleeper.eq.${id}`).join(",");
      const { data, error } = await admin.from("players").select("id, external_ids").or(ors);
      if (error) {
        warn("mapSleeperPlayerIds", error);
        continue;
      }
      for (const row of data ?? []) {
        const ext = row.external_ids as Record<string, unknown> | null;
        const sid = ext?.sleeper;
        if (typeof sid === "string" || typeof sid === "number") map.set(String(sid), row.id);
      }
    }
  } catch (err) {
    warn("mapSleeperPlayerIds", err);
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* Phase 8: market values                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How commonly each of these players is rostered anywhere, 0 to 1.
 *
 * Read from `player_roster_exposure`, a pre-calculated table rebuilt on the
 * nightly derived job (migration 0258). It is deliberately NOT computed here.
 * The aggregate behind it is one pass over every roster row on the site, about
 * 310ms at 3,704 rosters, and it grows with the number of leagues anyone has
 * ever opened. Running it per report would put a linearly worsening query on
 * the critical path of a page whose whole design goal is to paint immediately.
 *
 * A missing row means we have never seen that player on any roster, which is
 * NULL (we cannot say how common he is), not 0. The affinity module treats the
 * two differently and relies on that distinction: it excludes a player with an
 * unknown rate from the favourites ranking rather than ranking him as maximally
 * rare, which is what a 0 would do.
 */
async function fetchRosterExposure(
  admin: Client,
  sleeperIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = Array.from(new Set(sleeperIds.filter((id) => id.length > 0)));
  if (ids.length === 0) return out;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("player_roster_exposure")
      .select("sleeper_player_id, roster_rate")
      .in("sleeper_player_id", chunk);
    if (error) {
      // Non-fatal, like every other read here. Without the denominator the
      // favourites list simply has less to say; it does not become wrong.
      console.error("[manager-pulse/load] roster exposure read failed:", error.message);
      return out;
    }
    for (const row of data ?? []) {
      const rate = row.roster_rate == null ? null : Number(row.roster_rate);
      if (rate != null && Number.isFinite(rate)) out.set(row.sleeper_player_id, rate);
    }
  }
  return out;
}

async function fetchMarketValues(
  admin: Client,
  playerIds: string[],
): Promise<{ dynasty: Map<string, number>; redraft: Map<string, number> }> {
  const dynasty = new Map<string, number>();
  const redraft = new Map<string, number>();
  if (playerIds.length === 0) return { dynasty, redraft };

  try {
    const [{ data: formatRows, error: formatErr }, { data: registryRows, error: registryErr }] =
      await Promise.all([
        admin
          .from("format_configs")
          .select("id, slug")
          .in("slug", [DYNASTY_MARKET_FORMAT_SLUG, REDRAFT_MARKET_FORMAT_SLUG]),
        admin
          .from("source_registry")
          .select(
            "slug, display_name, description, priority, is_default, data_type, supported_format_slugs, update_cadence",
          )
          .eq("is_active", true)
          .order("priority"),
      ]);
    if (formatErr) warn("fetchMarketValues formats", formatErr);
    if (registryErr) warn("fetchMarketValues registry", registryErr);

    const formatIdBySlug = new Map((formatRows ?? []).map((r) => [r.slug, r.id]));
    const registry = (registryRows ?? []) as SourceRegistryRow[];

    const dynastyFormatId = formatIdBySlug.get(DYNASTY_MARKET_FORMAT_SLUG) ?? null;
    const redraftFormatId = formatIdBySlug.get(REDRAFT_MARKET_FORMAT_SLUG) ?? null;

    const dynastySource = dynastyFormatId
      ? resolveSourceForFormat(registry, "player_value_history", DYNASTY_MARKET_FORMAT_SLUG, null).source
      : null;
    const redraftSource = redraftFormatId
      ? resolveSourceForFormat(registry, "player_value_history", REDRAFT_MARKET_FORMAT_SLUG, null).source
      : null;

    async function fill(formatId: string | null, source: string | null, target: Map<string, number>) {
      if (!formatId || !source) return;
      for (const idChunk of chunk(playerIds)) {
        if (idChunk.length === 0) continue;
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await admin
            .from("player_value_trends")
            .select("player_id, current_value")
            .eq("format_config_id", formatId)
            .eq("source", source)
            .in("player_id", idChunk)
            .range(from, from + PAGE - 1);
          if (error) {
            warn("fetchMarketValues values", error);
            break;
          }
          if (!data || data.length === 0) break;
          for (const row of data) target.set(row.player_id, Number(row.current_value));
          if (data.length < PAGE) break;
        }
      }
    }

    await Promise.all([fill(dynastyFormatId, dynastySource, dynasty), fill(redraftFormatId, redraftSource, redraft)]);
  } catch (err) {
    warn("fetchMarketValues", err);
  }

  return { dynasty, redraft };
}

/* -------------------------------------------------------------------------- */
/* Phase 9: ledgers                                                          */
/* -------------------------------------------------------------------------- */

type LedgerRow = {
  league_id: string;
  season: number;
  sleeper_roster_id: number;
  weeks_graded: number;
  lineup_efficiency: number | null;
  waiver_moves: number;
  waiver_hits: number;
  waiver_faab_spent: number | null;
  waiver_points_started: number;
  waiver_points_on_roster: number;
  wins_left_on_bench: number;
  best_lineup_wins: number;
  best_lineup_losses: number;
  best_lineup_ties: number;
  efficiency_rank: number | null;
  scoring_rank: number | null;
};

async function fetchLedgerRows(admin: Client, leagueRowIds: string[]): Promise<LedgerRow[]> {
  const out: LedgerRow[] = [];
  if (leagueRowIds.length === 0) return out;
  try {
    for (const idChunk of chunk(leagueRowIds)) {
      if (idChunk.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("league_manager_ledger_cache")
          .select(
            "league_id, season, sleeper_roster_id, weeks_graded, lineup_efficiency, waiver_moves, waiver_hits, waiver_faab_spent, waiver_points_started, waiver_points_on_roster, wins_left_on_bench, best_lineup_wins, best_lineup_losses, best_lineup_ties, efficiency_rank, scoring_rank",
          )
          .in("league_id", idChunk)
          .range(from, from + PAGE - 1);
        if (error) {
          warn("fetchLedgerRows", error);
          break;
        }
        if (!data || data.length === 0) break;
        out.push(...(data as LedgerRow[]));
        if (data.length < PAGE) break;
      }
    }
  } catch (err) {
    warn("fetchLedgerRows", err);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Phase 10: matchups, for weekly move shape                                 */
/* -------------------------------------------------------------------------- */

type MatchupRow = {
  league_id: string;
  sleeper_roster_id: number;
  week: number;
  is_final: boolean;
  starter_ids: Json;
};

async function fetchMatchupsForManager(
  admin: Client,
  leagueRowIds: string[],
): Promise<Map<string, MatchupRow[]>> {
  const out = new Map<string, MatchupRow[]>();
  if (leagueRowIds.length === 0) return out;
  try {
    for (const idChunk of chunk(leagueRowIds)) {
      if (idChunk.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("league_matchups")
          .select("league_id, sleeper_roster_id, week, is_final, starter_ids")
          .in("league_id", idChunk)
          .range(from, from + PAGE - 1);
        if (error) {
          warn("fetchMatchupsForManager", error);
          break;
        }
        if (!data || data.length === 0) break;
        for (const row of data as MatchupRow[]) {
          const list = out.get(row.league_id) ?? [];
          list.push(row);
          out.set(row.league_id, list);
        }
        if (data.length < PAGE) break;
      }
    }
  } catch (err) {
    warn("fetchMatchupsForManager", err);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The entry point                                                           */
/* -------------------------------------------------------------------------- */

export async function loadManagerPulseInput(
  admin: Client,
  params: {
    sleeperUserId: string;
    handle: string;
    avatarUrl: string | null;
    seasonFrom: number;
    seasonTo: number;
    settings: ManagerPulseSettings;
    /** The league-seasons the capture step decided this report covers. */
    leagueSeasons: Array<{
      sleeperLeagueId: string;
      season: number;
      category: ManagerLeagueCategory | null;
      leagueName: string | null;
    }>;
    leagueSeasonsSkipped: number;
  },
): Promise<ManagerPulseInput> {
  const empty: ManagerPulseInput = {
    sleeperUserId: params.sleeperUserId,
    handle: params.handle,
    avatarUrl: params.avatarUrl,
    window: { seasonFrom: params.seasonFrom, seasonTo: params.seasonTo },
    settings: params.settings,
    leagueSeasons: [],
    players: {},
    handles: {},
    drafts: [],
    picks: [],
    pickObservations: [],
    moves: [],
    trades: [],
    ledgers: [],
    weeklyMoves: [],
    leagueSeasonsSkipped: params.leagueSeasonsSkipped,
  };

  try {
    const requestedSleeperLeagueIds = Array.from(
      new Set(params.leagueSeasons.map((l) => l.sleeperLeagueId)),
    );
    if (requestedSleeperLeagueIds.length === 0) return empty;

    // Phase 0 + 1: which leagues do we hold, and who owns which roster.
    const leagueRows = await fetchLeagueRows(admin, requestedSleeperLeagueIds);
    const leagueRowIds = Array.from(leagueRows.values()).map((r) => r.id);
    const rostersByLeagueRowId = await fetchRosters(admin, leagueRowIds);

    const { leagueSeasons, leagueRowIdToSeason } = buildLeagueSeasons(
      params.leagueSeasons,
      leagueRows,
      rostersByLeagueRowId,
      params.sleeperUserId,
    );
    if (leagueSeasons.length === 0) {
      return { ...empty, leagueSeasons: [] };
    }

    const keptLeagueRowIds = Array.from(leagueRowIdToSeason.keys());
    const bySleeperLeagueId = new Map(leagueSeasons.map((s) => [s.sleeperLeagueId, s]));

    // Phase 2: league users, for handles and trade-grading side labels.
    const leagueUsersByLeagueRowId = await fetchLeagueUsers(admin, keptLeagueRowIds);

    // Phase 3: drafts, ledgers, transactions, matchups. Independent reads.
    const [draftRows, ledgerRows, transactionRows, matchupsByLeagueRowId] = await Promise.all([
      fetchDrafts(admin, keptLeagueRowIds),
      fetchLedgerRows(admin, keptLeagueRowIds),
      fetchTransactions(admin, keptLeagueRowIds),
      fetchMatchupsForManager(admin, keptLeagueRowIds),
    ]);

    const draftIds = draftRows.map((d) => d.sleeper_draft_id);
    const selectionRows = await fetchSelections(admin, draftIds);

    // Selections grouped by draft, for totalPicks and pool detection.
    const selectionsByDraft = new Map<string, SelectionRow[]>();
    for (const row of selectionRows) {
      const list = selectionsByDraft.get(row.sleeper_draft_id) ?? [];
      list.push(row);
      selectionsByDraft.set(row.sleeper_draft_id, list);
    }

    // ---------------------------------------------------------------------
    // Drafts
    // ---------------------------------------------------------------------
    const drafts: ManagerDraftFacts[] = [];
    for (const d of draftRows) {
      const season = leagueRowIdToSeason.get(d.league_id);
      if (!season) continue;
      const settings = (d.settings ?? {}) as Record<string, unknown>;
      const metadata = (d.metadata ?? {}) as { start_time?: unknown; last_picked?: unknown };
      const rounds = numberOrNull(settings.rounds);
      const teams = numberOrNull(settings.teams) ?? season.teamCount;
      const pickTimerSeconds = numberOrNull(settings.pick_timer);

      const startedAtMs = d.start_time
        ? Date.parse(d.start_time)
        : numberOrNull(metadata.start_time);
      const lastPickedAtMs = numberOrNull(metadata.last_picked);

      const selections = selectionsByDraft.get(d.sleeper_draft_id) ?? [];
      const totalPicks = selections.length;
      const capturedPool = selections.find((s) => s.player_pool)?.player_pool ?? null;

      // Whether this is a startup draft is a dynasty-only question. A
      // redraft/keeper draft is definitively not a startup. Within dynasty,
      // classifyDraftPool (lib/startup-draft.ts, shared with On The Clock and
      // the trade grader) needs a "dynasty"-prefixed formatSlug string to
      // gate on and, absent captured evidence, a real round count; we pass a
      // synthetic "dynasty" marker rather than the league's exact supported
      // format slug because the function only ever checks the "dynasty"
      // prefix, and a league whose exact scoring format FF Beacon does not
      // carry must not be misclassified as "cannot tell dynasty" as a result.
      const isDynastyLens = season.category === "dynasty" || season.category === "best-ball-dynasty";
      let isStartup: boolean | null = null;
      if (!isDynastyLens) {
        isStartup = false;
      } else if (capturedPool || (Number.isFinite(rounds) && (rounds ?? 0) > 0)) {
        isStartup =
          classifyDraftPool({ formatSlug: "dynasty", rounds: rounds ?? 0, capturedPool }) === "startup";
      }

      drafts.push({
        sleeperDraftId: d.sleeper_draft_id,
        sleeperLeagueId: season.sleeperLeagueId,
        season: season.season,
        category: season.category,
        draftType: d.type,
        rounds,
        teams,
        pickTimerSeconds,
        startedAtMs: Number.isFinite(startedAtMs) ? (startedAtMs as number) : null,
        lastPickedAtMs,
        totalPicks,
        isStartup,
      });
    }

    // ---------------------------------------------------------------------
    // Picks (this manager's own selections only)
    // ---------------------------------------------------------------------
    const draftToLeagueRowId = new Map(draftRows.map((d) => [d.sleeper_draft_id, d.league_id]));
    const picks: ManagerDraftPick[] = [];
    const distinctFormatSlugs = new Set<string>();
    const distinctSeasons = new Set<number>();
    const pickPlayerIds = new Set<string>();

    for (const row of selectionRows) {
      const leagueRowId = draftToLeagueRowId.get(row.sleeper_draft_id);
      const season = leagueRowId ? leagueRowIdToSeason.get(leagueRowId) : undefined;
      if (!season) continue;
      if (row.roster_id !== season.rosterId) continue; // Only this manager's own picks.

      const formatSlug =
        row.format_slug ??
        (() => {
          const leagueRow = leagueRows.get(season.sleeperLeagueId);
          if (!leagueRow) return null;
          const raw = leagueRow.metadata as unknown as SleeperLeague;
          return mapToFormatSlug(deriveLeagueFormat(raw));
        })();

      if (formatSlug) distinctFormatSlugs.add(formatSlug);
      distinctSeasons.add(season.season);
      if (row.player_id) pickPlayerIds.add(row.player_id);

      picks.push({
        sleeperDraftId: row.sleeper_draft_id,
        sleeperLeagueId: season.sleeperLeagueId,
        season: season.season,
        category: season.category,
        pickNo: Number(row.pick_no),
        round: row.round,
        playerId: row.player_id,
        sleeperPlayerId: row.sleeper_player_id,
        isKeeper: Boolean(row.is_keeper),
        // marketAdp filled below, once distinct format slugs/seasons are known.
        marketAdp: null,
        // ABSOLUTE: no per-pick grading is implemented here. draft_selections
        // carries no grade column and lib/on-the-clock/draft-grade.ts is a
        // pure compute function over a live/derived board, not a stored
        // value this read layer may call. Every pick's grade is null; see
        // the report for the sibling gap this leaves in ManagerDrafting.
        grade: null,
        wasRookie: null, // filled below once players are loaded
      });
    }

    // ---------------------------------------------------------------------
    // Transactions: moves and trades, per league-season
    // ---------------------------------------------------------------------
    const transactionsByLeagueRowId = new Map<string, TransactionRow[]>();
    for (const row of transactionRows) {
      const list = transactionsByLeagueRowId.get(row.league_id) ?? [];
      list.push(row);
      transactionsByLeagueRowId.set(row.league_id, list);
    }

    // Collect every Sleeper player id referenced in adds/drops across every
    // transaction that touches this manager, across every league-season, so
    // the mapping query runs once for the whole report.
    const sleeperIdsToMap = new Set<string>();
    const relevantTransactionsByLeagueRowId = new Map<string, TransactionRow[]>();
    for (const [leagueRowId, rows] of transactionsByLeagueRowId) {
      const season = leagueRowIdToSeason.get(leagueRowId);
      if (!season || season.rosterId === null) continue;
      const relevant = rows.filter((r) => touchesRoster(r, season.rosterId as number));
      if (relevant.length === 0) continue;
      relevantTransactionsByLeagueRowId.set(leagueRowId, relevant);
      for (const row of relevant) {
        for (const sid of Object.keys(rosterMap(row.adds))) sleeperIdsToMap.add(sid);
        for (const sid of Object.keys(rosterMap(row.drops))) sleeperIdsToMap.add(sid);
      }
    }

    const sleeperToPlayerId = await mapSleeperPlayerIds(admin, Array.from(sleeperIdsToMap));

    const moves: ManagerMove[] = [];
    const trades: ManagerTrade[] = [];
    const handles: Record<string, string> = {};
    let unmappedMoveCount = 0;

    /**
     * Grading runs a few leagues at a time, not one after another.
     *
     * `analyzeLeagueTrades` is a dozen or so queries per league-season, and it
     * deliberately resolves format and values once per league, so it cannot be
     * collapsed into a single call. Run strictly in series across 40 league-
     * seasons that is a few hundred sequential round trips: several seconds of
     * pure latency on the critical path of a page whose whole design goal is to
     * paint quickly. A few at a time keeps concurrency well inside what the
     * connection pool absorbs while cutting most of that wall clock.
     *
     * Each task returns its OWN arrays, concatenated afterwards in the original
     * league order. Pushing into shared arrays from concurrent tasks would be
     * safe in a single-threaded runtime, but the output order would then depend
     * on which query happened to finish first, and a report that reorders
     * itself between two identical runs is a report nobody can diff.
     */
    type LeagueGradeResult = {
      moves: ManagerMove[];
      trades: ManagerTrade[];
      handles: Record<string, string>;
      unmapped: number;
    };
    const noLeagueResult: LeagueGradeResult = { moves: [], trades: [], handles: {}, unmapped: 0 };

    const gradedByLeague = await mapLimit(
      Array.from(relevantTransactionsByLeagueRowId),
      TRADE_GRADE_CONCURRENCY,
      async ([leagueRowId, relevant]): Promise<LeagueGradeResult> => {
        const localMoves: ManagerMove[] = [];
        const localTrades: ManagerTrade[] = [];
        const localHandles: Record<string, string> = {};
        let localUnmapped = 0;
        /** This league's work so far, for the early returns below. */
        const done = (): LeagueGradeResult => ({
          moves: localMoves,
          trades: localTrades,
          handles: localHandles,
          unmapped: localUnmapped,
        });
        const season = leagueRowIdToSeason.get(leagueRowId);
        if (!season || season.rosterId === null) return noLeagueResult;
        const rosterId = season.rosterId;

        // Build moves (every kind, including trades, for the raw activity log).
        for (const row of relevant) {
          const adds = rosterMap(row.adds);
          const drops = rosterMap(row.drops);
          const added: string[] = [];
          const dropped: string[] = [];
          for (const [sid, rid] of Object.entries(adds)) {
            if (rid !== rosterId) continue;
            const pid = sleeperToPlayerId.get(sid);
            if (pid) added.push(pid);
            else localUnmapped += 1;
          }
          for (const [sid, rid] of Object.entries(drops)) {
            if (rid !== rosterId) continue;
            const pid = sleeperToPlayerId.get(sid);
            if (pid) dropped.push(pid);
            else localUnmapped += 1;
          }
          const meta = (row.metadata ?? {}) as { settings?: Record<string, unknown> };
          const faabSpent = row.type === "waiver" ? numberOrNull(meta.settings?.waiver_bid) : null;

          localMoves.push({
            sleeperTransactionId: row.sleeper_transaction_id,
            sleeperLeagueId: season.sleeperLeagueId,
            season: row.season ?? season.season,
            week: row.week,
            category: season.category,
            kind: mapMoveKind(row.type),
            createdAtMs: row.created_at_sleeper ? Date.parse(row.created_at_sleeper) : null,
            addedPlayerIds: added,
            droppedPlayerIds: dropped,
            faabSpent,
            faabBudget: season.faabBudget,
          });
        }

        // Grade this league-season's trades through Signal Check, ONE CALL.
        const tradeRows = relevant.filter((r) => r.type === "trade");
        if (tradeRows.length === 0) return done();

        const leagueRow = leagueRows.get(season.sleeperLeagueId);
        if (!leagueRow) return done();
        const sleeperLeague = leagueRow.metadata as unknown as SleeperLeague;
        const usersMap = leagueUsersByLeagueRowId.get(leagueRowId) ?? new Map<string, string>();
        const rostersHere = rostersByLeagueRowId.get(leagueRowId) ?? [];
        const ownerByRoster = new Map(rostersHere.map((r) => [r.sleeper_roster_id, r]));
        const rosterLabels: Record<number, string> = {};
        for (const r of rostersHere) {
          const owner = r.owner_user_id ? usersMap.get(r.owner_user_id) : null;
          rosterLabels[r.sleeper_roster_id] = owner ?? `Roster ${r.sleeper_roster_id}`;
        }

        let analysis;
        try {
          analysis = await analyzeLeagueTrades(admin, {
            sleeperLeague,
            leagueRowId,
            rosterLabels,
            trades: tradeRows.map<LeagueTradeInput>((r) => ({
              sleeperTransactionId: r.sleeper_transaction_id,
              adds: rosterMap(r.adds),
              draftPicks: normalizePicks(r.draft_picks),
              createdAtSleeper: r.created_at_sleeper,
            })),
          });
        } catch (err) {
          warn(`analyzeLeagueTrades league ${season.sleeperLeagueId} season ${season.season}`, err);
          analysis = null;
        }

        for (const row of tradeRows) {
          const adds = rosterMap(row.adds);
          const normalizedPicks = normalizePicks(row.draft_picks);
          const order = tradeRosterOrder(adds, normalizedPicks);
          const managerSide: SideKey | null =
            order.length === 2 ? (order[0] === rosterId ? "a" : order[1] === rosterId ? "b" : null) : null;
          const otherRosterId =
            order.length === 2 ? (order[0] === rosterId ? order[1] : order[0]) : null;

          const incomingPlayerIds: string[] = [];
          const outgoingPlayerIds: string[] = [];
          for (const [sid, rid] of Object.entries(adds)) {
            const pid = sleeperToPlayerId.get(sid);
            if (!pid) continue;
            if (rid === rosterId) incomingPlayerIds.push(pid);
            else if (rid === otherRosterId) outgoingPlayerIds.push(pid);
          }
          // The round on each side, for the pick-flow chart. A pick whose
          // round Sleeper did not publish is still counted below; it just
          // contributes no round, rather than being guessed at as a first.
          const pickRound = (p: TradedPickEntry): number | null => {
            const round = Number(p.round);
            return Number.isFinite(round) && round > 0 ? Math.trunc(round) : null;
          };
          const incomingPickRounds = normalizedPicks
            .filter((p) => Number(p.owner_id) === rosterId)
            .map(pickRound)
            .filter((r): r is number => r !== null);
          const outgoingPickRounds = normalizedPicks
            .filter((p) => Number(p.previous_owner_id) === rosterId)
            .map(pickRound)
            .filter((r): r is number => r !== null);

          const incomingPickCount = normalizedPicks.filter((p) => Number(p.owner_id) === rosterId).length;
          const outgoingPickCount = normalizedPicks.filter(
            (p) => Number(p.previous_owner_id) === rosterId,
          ).length;

          // Counterparty identity, for the handles map.
          if (otherRosterId != null) {
            const otherRoster = ownerByRoster.get(otherRosterId);
            if (otherRoster?.owner_user_id) {
              const name = usersMap.get(otherRoster.owner_user_id);
              if (name) localHandles[otherRoster.owner_user_id] = name;
            }
          }
          const counterpartyUserIds =
            otherRosterId != null && ownerByRoster.get(otherRosterId)?.owner_user_id
              ? [ownerByRoster.get(otherRosterId)!.owner_user_id as string]
              : [];

          const graded = managerSide ? analysis?.results.get(row.sleeper_transaction_id) : undefined;
          let marginPct: number | null = null;
          let verdictLabel: string | null = null;
          let valueIn: number | null = null;
          let valueOut: number | null = null;
          let hasUnpricedPick = false;

          if (graded && managerSide) {
            const view = graded.view;
            const otherSide: SideKey = managerSide === "a" ? "b" : "a";
            marginPct =
              view.winnerSide === null ? 0 : view.winnerSide === managerSide ? view.marginPct : -view.marginPct;
            verdictLabel = view.verdictLabel;
            const mySide = view.sides.find((s) => s.side === managerSide) ?? null;
            const theirSide = view.sides.find((s) => s.side === otherSide) ?? null;
            valueIn = mySide?.total ?? null;
            valueOut = theirSide?.total ?? null;

            // Precise check: any PICK-kind asset priced with no value, on either
            // side. Broader flags (hasBlendedPicks / hasEstimatedPicks) mean the
            // pick was priced but only approximately, which is not "unpriced";
            // only a true noValue pick asset earns the flag.
            for (const side of ["a", "b"] as SideKey[]) {
              const meta = graded.assetMeta[side] ?? [];
              const assets = view.sides.find((s) => s.side === side)?.assets ?? [];
              for (let i = 0; i < meta.length; i += 1) {
                if (meta[i]?.kind === "pick" && assets[i]?.noValue) hasUnpricedPick = true;
              }
            }
          }

          localTrades.push({
            sleeperTransactionId: row.sleeper_transaction_id,
            sleeperLeagueId: season.sleeperLeagueId,
            season: row.season ?? season.season,
            week: row.week,
            category: season.category,
            createdAtMs: row.created_at_sleeper ? Date.parse(row.created_at_sleeper) : null,
            counterpartyUserIds,
            incomingPlayerIds,
            outgoingPlayerIds,
            incomingPickCount,
            outgoingPickCount,
            incomingPickRounds,
            outgoingPickRounds,
            marginPct,
            verdictLabel,
            valueIn,
            valueOut,
            hasUnpricedPick,
          });
        }
        return done();
      },
    );

    for (const result of gradedByLeague) {
      moves.push(...result.moves);
      trades.push(...result.trades);
      Object.assign(handles, result.handles);
      unmappedMoveCount += result.unmapped;
    }


    // ---------------------------------------------------------------------
    // Players: union of ids referenced by picks, moves, and trades.
    // ---------------------------------------------------------------------
    const playerIdSet = new Set<string>(pickPlayerIds);
    for (const pid of sleeperToPlayerId.values()) playerIdSet.add(pid);
    const playerIds = Array.from(playerIdSet);

    const playerRows = await fetchPlayers(admin, playerIds);
    const { dynasty: dynastyValues, redraft: redraftValues } = await fetchMarketValues(admin, playerIds);

    // Sleeper ids first, because player_roster_exposure is keyed by the id
    // Sleeper puts inside rosters.player_ids, not by our own player id.
    const sleeperIdByPlayer = new Map<string, string>();
    for (const [id, row] of playerRows) {
      const ext = (row.external_ids ?? {}) as Record<string, unknown>;
      const sid =
        typeof ext.sleeper === "string" || typeof ext.sleeper === "number"
          ? String(ext.sleeper)
          : null;
      if (sid) sleeperIdByPlayer.set(id, sid);
    }
    const rosterExposure = await fetchRosterExposure(
      admin,
      Array.from(sleeperIdByPlayer.values()),
    );

    const players: Record<string, ManagerPlayerFacts> = {};
    for (const [id, row] of playerRows) {
      const ext = (row.external_ids ?? {}) as Record<string, unknown>;
      const sleeperId = typeof ext.sleeper === "string" || typeof ext.sleeper === "number" ? String(ext.sleeper) : null;
      players[id] = {
        playerId: id,
        sleeperId,
        name: row.full_name ?? `${row.first_name} ${row.last_name}`.trim(),
        position: readTradePosition(row.position),
        age: ageFromBirthDate(row.birth_date),
        marketValue: {
          dynasty: dynastyValues.get(id) ?? null,
          redraft: redraftValues.get(id) ?? null,
        },
        // From the pre-calculated player_roster_exposure table. Null when we
        // have never seen this player on any roster, which is "we cannot say
        // how common he is" rather than "nobody has him". See
        // fetchRosterExposure for why this is not computed here.
        leagueWideRosterRate:
          sleeperId != null ? (rosterExposure.get(sleeperId) ?? null) : null,
      };
    }

    // Backfill wasRookie now that players are loaded.
    for (const pick of picks) {
      if (!pick.playerId) continue;
      const player = playerRows.get(pick.playerId);
      pick.wasRookie = player && player.draft_year != null ? player.draft_year === pick.season : null;
    }

    // Backfill marketAdp now that distinct format slugs/seasons are known.
    const marketAdpMap = await fetchMarketAdp(
      admin,
      Array.from(pickPlayerIds),
      Array.from(distinctFormatSlugs),
      Array.from(distinctSeasons),
    );
    const selectionByDraftAndPick = new Map(
      selectionRows.map((s) => [`${s.sleeper_draft_id}|${s.pick_no}`, s]),
    );
    for (const pick of picks) {
      if (!pick.playerId) continue;
      const row = selectionByDraftAndPick.get(`${pick.sleeperDraftId}|${pick.pickNo}`);
      const formatSlug = row?.format_slug;
      const pool = row?.player_pool;
      if (!formatSlug || !pool) continue;
      const key = `${formatSlug}|${pool}|${pick.season}|${pick.playerId}`;
      pick.marketAdp = marketAdpMap.get(key) ?? null;
    }

    // ---------------------------------------------------------------------
    // Ledgers
    // ---------------------------------------------------------------------
    const ledgers: ManagerLedgerFacts[] = [];
    for (const row of ledgerRows) {
      const season = leagueRowIdToSeason.get(row.league_id);
      if (!season || season.rosterId !== row.sleeper_roster_id) continue;
      ledgers.push({
        sleeperLeagueId: season.sleeperLeagueId,
        season: season.season,
        category: season.category,
        weeksGraded: Number(row.weeks_graded) || 0,
        lineupEfficiency: row.lineup_efficiency,
        waiverMoves: row.waiver_moves,
        waiverHits: row.waiver_hits,
        waiverFaabSpent: row.waiver_faab_spent,
        waiverPointsStarted: row.waiver_points_started,
        waiverPointsOnRoster: row.waiver_points_on_roster,
        winsLeftOnBench: row.wins_left_on_bench,
        bestLineupWins: row.best_lineup_wins,
        bestLineupLosses: row.best_lineup_losses,
        bestLineupTies: row.best_lineup_ties,
        efficiencyRank: row.efficiency_rank,
        scoringRank: row.scoring_rank,
      });
    }

    // ---------------------------------------------------------------------
    // Weekly moves
    // ---------------------------------------------------------------------
    const weeklyMoves: ManagerWeeklyMoves[] = [];
    for (const season of leagueSeasons) {
      if (season.rosterId === null || !season.leagueId) continue;
      const movesByWeek: Record<number, number> = {};
      for (const move of moves) {
        if (move.sleeperLeagueId !== season.sleeperLeagueId || move.season !== season.season) continue;
        if (move.week === null) continue;
        movesByWeek[move.week] = (movesByWeek[move.week] ?? 0) + 1;
      }

      const matchupRows = matchupsByLeagueRowId.get(season.leagueId) ?? [];
      const managerRows = matchupRows.filter((r) => r.sleeper_roster_id === season.rosterId);
      let lastWeekPlayed: number | null = null;
      let weeksWithIncompleteLineup = 0;
      for (const row of managerRows) {
        if (row.is_final && (lastWeekPlayed === null || row.week > lastWeekPlayed)) {
          lastWeekPlayed = row.week;
        }
        const starters = asStringArray(row.starter_ids);
        if (starters.includes("0")) weeksWithIncompleteLineup += 1;
      }

      weeklyMoves.push({
        sleeperLeagueId: season.sleeperLeagueId,
        season: season.season,
        category: season.category,
        movesByWeek,
        lastWeekPlayed,
        weeksWithIncompleteLineup,
      });
    }

    if (unmappedMoveCount > 0) {
      console.warn(
        `[manager-pulse/load] ${unmappedMoveCount} added/dropped player ids for ${params.handle} could not be mapped to a player and were dropped from the moves log`,
      );
    }

    return {
      sleeperUserId: params.sleeperUserId,
      handle: params.handle,
      avatarUrl: params.avatarUrl,
      window: { seasonFrom: params.seasonFrom, seasonTo: params.seasonTo },
      settings: params.settings,
      leagueSeasons,
      players,
      handles,
      drafts,
      picks,
      pickObservations: await fetchPickObservations(admin, draftIds),
      moves,
      trades,
      ledgers,
      weeklyMoves,
      leagueSeasonsSkipped: params.leagueSeasonsSkipped,
    };
  } catch (err) {
    warn("loadManagerPulseInput", err);
    return empty;
  }
}
