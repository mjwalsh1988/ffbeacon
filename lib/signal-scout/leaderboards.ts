/**
 * Signal Scout leaderboard query layer (plan: signal-scout-plan.md section 8).
 *
 * This is the single implementation of the three leaderboard boards (daily,
 * all_time, streak): board ordering and tie-breakers, the hidden/admin
 * exclusion set, page-aware ranks, the personal "your rank" strip, and the
 * total-pages count. It is consumed by app/api/games/signal-scout/leaderboards/route.ts
 * (the JSON API) and app/games/signal-scout/page.tsx (which server-renders
 * page 1 of the default board into the game page's leaderboard rail), so both
 * surfaces share one query implementation. The rail then calls the JSON API
 * for every other board and page.
 *
 * NOTE: loadLeaderboardPreview at the bottom of this file is currently unused.
 * It powered the top-5 "Today's Top Scouts" panel on the game page, which the
 * leaderboard rail replaced.
 *
 * Identity resolution: public display names and avatars come from
 * lib/user-identity.ts resolveUserIdentities(), called once per request with
 * the masked-email "public" surface. A user id missing from the resolved map
 * defensively falls back to scoutFallbackLabel(), a deterministic
 * "Scout-XXXX" derived from the user id. Raw auth user ids never leave this
 * module: every row returned carries only rank, display name, a signed
 * avatar URL, isYou, and stats.
 *
 * Hidden/admin exclusion: rows for users flagged hidden_from_leaderboards,
 * and (when hideAdminUsers is on) admins, are excluded. The daily board
 * lives in signal_scout_daily_scores which carries no hidden flag, so
 * buildExclusionSet pre-fetches a single set of user_ids (hidden users from
 * signal_scout_user_stats plus admins from user_preferences) and every
 * board query, count query, and your-rank query applies it uniformly via a
 * `user_id NOT IN (...)` filter.
 */

import { unstable_cache } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { currentEasternGameDate } from "./streaks";
import {
  resolveUserIdentities,
  scoutFallbackLabel,
  type ResolvedUserIdentity,
} from "@/lib/user-identity";

export type Client = SupabaseClient<Database>;
export type Board = "daily" | "all_time" | "streak";

export const boardSchema = z.enum(["daily", "all_time", "streak"]);

export const PAGE_SIZE = 25;
export const MAX_PAGE = 200;
export const CACHE_TTL_SECONDS = 60;
export const PREVIEW_SIZE = 5;

/** Round to one decimal place. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

interface ExclusionFilterable {
  not: (column: string, operator: string, value: string) => ExclusionFilterable;
}

/**
 * Apply `user_id NOT IN (...)` when the exclusion set is non-empty (an empty
 * IN list is invalid SQL). The interpolated ids are safe from injection ONLY
 * because every caller sources them from a uuid FK to auth.users(id):
 * signal_scout_user_stats.user_id, signal_scout_daily_scores.user_id, and
 * user_preferences.user_id. A uuid column cannot contain SQL metacharacters.
 * Do not reuse this helper with ids drawn from any less-trusted source.
 */
function applyExclusion<T extends ExclusionFilterable>(query: T, ids: string[]): T {
  if (ids.length === 0) return query;
  return query.not("user_id", "in", `(${ids.join(",")})`) as T;
}

/** hidden users (signal_scout_user_stats) plus admins (user_preferences, when hideAdmins). */
export async function buildExclusionSet(admin: Client, hideAdmins: boolean): Promise<string[]> {
  const ids = new Set<string>();

  const { data: hidden, error: hiddenError } = await admin
    .from("signal_scout_user_stats")
    .select("user_id")
    .eq("hidden_from_leaderboards", true);
  if (hiddenError) throw hiddenError;
  for (const row of hidden ?? []) ids.add(row.user_id);

  if (hideAdmins) {
    const { data: admins, error: adminError } = await admin
      .from("user_preferences")
      .select("user_id")
      .eq("is_admin", true);
    if (adminError) throw adminError;
    for (const row of admins ?? []) ids.add(row.user_id);
  }

  return [...ids];
}

interface RawDaily {
  user_id: string;
  points: number;
  rounds: number;
  wins: number;
  first_play_at: string;
}

interface RawAllTime {
  user_id: string;
  total_points: number;
  rounds_won: number;
  rounds_played: number;
  best_signal_streak: number;
}

interface RawStreak {
  user_id: string;
  best_signal_streak: number;
  current_signal_streak: number;
  total_points: number;
}

/**
 * Fetch one board page (already ordered + excluded + ranged by the DB). No
 * mapping here. `pageSize` defaults to PAGE_SIZE for the paginated
 * leaderboards page; loadLeaderboardPreview passes PREVIEW_SIZE instead so
 * the preview panel reuses this same ordering/filtering rather than
 * duplicating it.
 */
export async function queryBoardRows(
  admin: Client,
  board: Board,
  page: number,
  exclusionIds: string[],
  etDate: string,
  pageSize: number = PAGE_SIZE,
): Promise<RawDaily[] | RawAllTime[] | RawStreak[]> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (board === "daily") {
    const base = admin
      .from("signal_scout_daily_scores")
      .select("user_id, points, rounds, wins, first_play_at")
      .eq("game_date", etDate)
      .order("points", { ascending: false })
      .order("rounds", { ascending: true })
      .order("first_play_at", { ascending: true });
    const { data, error } = await applyExclusion(base, exclusionIds).range(from, to);
    if (error) throw error;
    return (data ?? []) as RawDaily[];
  }

  if (board === "all_time") {
    const base = admin
      .from("signal_scout_user_stats")
      .select("user_id, total_points, rounds_won, rounds_played, best_signal_streak")
      .order("total_points", { ascending: false })
      .order("rounds_won", { ascending: false })
      .order("first_played_at", { ascending: true });
    const { data, error } = await applyExclusion(base, exclusionIds).range(from, to);
    if (error) throw error;
    return (data ?? []) as RawAllTime[];
  }

  const base = admin
    .from("signal_scout_user_stats")
    .select("user_id, best_signal_streak, current_signal_streak, total_points")
    .order("best_signal_streak", { ascending: false })
    .order("total_points", { ascending: false });
  const { data, error } = await applyExclusion(base, exclusionIds).range(from, to);
  if (error) throw error;
  return (data ?? []) as RawStreak[];
}

/**
 * Count the full (excluded, unpaginated) board size for totalPages. Same
 * table + filters as queryBoardRows for the given board, minus ordering and
 * range. daily is filtered to the given ET date; all_time and streak share
 * the same unfiltered signal_scout_user_stats count.
 */
export async function countBoardRows(
  admin: Client,
  board: Board,
  exclusionIds: string[],
  etDate: string,
): Promise<number> {
  if (board === "daily") {
    const base = admin
      .from("signal_scout_daily_scores")
      .select("*", { count: "exact", head: true })
      .eq("game_date", etDate);
    const { count, error } = await applyExclusion(base, exclusionIds);
    if (error) throw error;
    return count ?? 0;
  }

  const base = admin
    .from("signal_scout_user_stats")
    .select("*", { count: "exact", head: true });
  const { count, error } = await applyExclusion(base, exclusionIds);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Caches identity resolution (display name + signed avatar URL) for
 * CACHE_TTL_SECONDS, keyed by the sorted set of requested user ids so the
 * cache key is order-insensitive (unstable_cache hashes its arguments into
 * the key, and Set iteration order otherwise varies by call site).
 *
 * Resolved identities are public display data, identical for every viewer
 * regardless of who is asking, and the 1-hour signed avatar URL TTL far
 * exceeds this 60-second cache window, so a cached entry never serves a
 * broken avatar link. Caching also caps the per-request GoTrue admin lookups
 * and storage signing fan-out the Phase 5 security review flagged as an
 * amplification vector: without this, every leaderboard view re-issues one
 * auth.admin.getUserById call per distinct user on the board, every request.
 *
 * resolveUserIdentities returns a Map, which does not survive unstable_cache's
 * JSON serialization of its return value, so the cached function converts to
 * a plain array of [id, identity] entries and this wrapper rebuilds the Map.
 */
export async function cachedResolveIdentities(
  admin: Client,
  ids: string[],
): Promise<Map<string, ResolvedUserIdentity>> {
  const sortedIds = [...ids].sort();
  const cached = unstable_cache(
    async (sorted: string[]) => {
      const identities = await resolveUserIdentities(admin, sorted, "public");
      return [...identities.entries()];
    },
    ["signal-scout-identities"],
    { revalidate: CACHE_TTL_SECONDS },
  );
  const entries = await cached(sortedIds);
  return new Map(entries);
}

/** User ids resolved but missing from the map (should not happen) fall back to the deterministic label. */
export function identityFor(
  identities: Map<string, ResolvedUserIdentity>,
  userId: string,
): ResolvedUserIdentity {
  return identities.get(userId) ?? { displayName: scoutFallbackLabel(userId), avatarUrl: null };
}

interface BoardRowBase {
  rank: number;
  scout: string;
  avatarUrl: string | null;
  isYou: boolean;
}

export interface DailyBoardRow extends BoardRowBase {
  points: number;
  rounds: number;
  accuracy: number | null;
}

export interface AllTimeBoardRow extends BoardRowBase {
  totalPoints: number;
  wins: number;
  winRate: number | null;
  bestStreak: number;
}

export interface StreakBoardRow extends BoardRowBase {
  bestStreak: number;
  currentStreak: number;
  totalPoints: number;
}

export type LeaderboardRow = DailyBoardRow | AllTimeBoardRow | StreakBoardRow;

/** Map raw rows to public DTOs, assigning page-aware ranks and dropping raw user ids. */
export function mapRows(
  board: Board,
  rawRows: RawDaily[] | RawAllTime[] | RawStreak[],
  page: number,
  meId: string | null,
  identities: Map<string, ResolvedUserIdentity>,
): LeaderboardRow[] {
  const offset = (page - 1) * PAGE_SIZE;

  if (board === "daily") {
    return (rawRows as RawDaily[]).map((row, index): DailyBoardRow => {
      const identity = identityFor(identities, row.user_id);
      return {
        rank: offset + index + 1,
        scout: identity.displayName,
        avatarUrl: identity.avatarUrl,
        isYou: meId !== null && row.user_id === meId,
        points: row.points,
        rounds: row.rounds,
        accuracy: row.rounds === 0 ? null : round1((row.wins / row.rounds) * 100),
      };
    });
  }

  if (board === "all_time") {
    return (rawRows as RawAllTime[]).map((row, index): AllTimeBoardRow => {
      const identity = identityFor(identities, row.user_id);
      return {
        rank: offset + index + 1,
        scout: identity.displayName,
        avatarUrl: identity.avatarUrl,
        isYou: meId !== null && row.user_id === meId,
        totalPoints: row.total_points,
        wins: row.rounds_won,
        winRate:
          row.rounds_played === 0 ? null : round1((row.rounds_won / row.rounds_played) * 100),
        bestStreak: row.best_signal_streak,
      };
    });
  }

  return (rawRows as RawStreak[]).map((row, index): StreakBoardRow => {
    const identity = identityFor(identities, row.user_id);
    return {
      rank: offset + index + 1,
      scout: identity.displayName,
      avatarUrl: identity.avatarUrl,
      isYou: meId !== null && row.user_id === meId,
      bestStreak: row.best_signal_streak,
      currentStreak: row.current_signal_streak,
      totalPoints: row.total_points,
    };
  });
}

/**
 * Personal "your rank" strip: the caller's own row plus rank = 1 + (count of
 * strictly-better rows). Strictly greater only, so tied scores share the
 * better rank. Excludes hidden/admin rows the same way the board does. Null
 * when the caller has no row on the board.
 */
export async function computeYourRank(
  admin: Client,
  board: Board,
  meId: string,
  exclusionIds: string[],
  etDate: string,
  identities: Map<string, ResolvedUserIdentity>,
): Promise<LeaderboardRow | null> {
  const myIdentity = identityFor(identities, meId);

  if (board === "daily") {
    const { data: own, error } = await admin
      .from("signal_scout_daily_scores")
      .select("points, rounds, wins")
      .eq("game_date", etDate)
      .eq("user_id", meId)
      .maybeSingle();
    if (error) throw error;
    if (!own) return null;

    const countQuery = admin
      .from("signal_scout_daily_scores")
      .select("*", { count: "exact", head: true })
      .eq("game_date", etDate)
      .gt("points", own.points);
    const { count, error: countError } = await applyExclusion(countQuery, exclusionIds);
    if (countError) throw countError;

    const row: DailyBoardRow = {
      rank: 1 + (count ?? 0),
      scout: myIdentity.displayName,
      avatarUrl: myIdentity.avatarUrl,
      isYou: true,
      points: own.points,
      rounds: own.rounds,
      accuracy: own.rounds === 0 ? null : round1((own.wins / own.rounds) * 100),
    };
    return row;
  }

  if (board === "all_time") {
    const { data: own, error } = await admin
      .from("signal_scout_user_stats")
      .select("total_points, rounds_won, rounds_played, best_signal_streak")
      .eq("user_id", meId)
      .maybeSingle();
    if (error) throw error;
    if (!own) return null;

    const countQuery = admin
      .from("signal_scout_user_stats")
      .select("*", { count: "exact", head: true })
      .gt("total_points", own.total_points);
    const { count, error: countError } = await applyExclusion(countQuery, exclusionIds);
    if (countError) throw countError;

    const row: AllTimeBoardRow = {
      rank: 1 + (count ?? 0),
      scout: myIdentity.displayName,
      avatarUrl: myIdentity.avatarUrl,
      isYou: true,
      totalPoints: own.total_points,
      wins: own.rounds_won,
      winRate: own.rounds_played === 0 ? null : round1((own.rounds_won / own.rounds_played) * 100),
      bestStreak: own.best_signal_streak,
    };
    return row;
  }

  const { data: own, error } = await admin
    .from("signal_scout_user_stats")
    .select("best_signal_streak, current_signal_streak, total_points")
    .eq("user_id", meId)
    .maybeSingle();
  if (error) throw error;
  if (!own) return null;

  const countQuery = admin
    .from("signal_scout_user_stats")
    .select("*", { count: "exact", head: true })
    .gt("best_signal_streak", own.best_signal_streak);
  const { count, error: countError } = await applyExclusion(countQuery, exclusionIds);
  if (countError) throw countError;

  const row: StreakBoardRow = {
    rank: 1 + (count ?? 0),
    scout: myIdentity.displayName,
    avatarUrl: myIdentity.avatarUrl,
    isYou: true,
    bestStreak: own.best_signal_streak,
    currentStreak: own.current_signal_streak,
    totalPoints: own.total_points,
  };
  return row;
}

export interface LeaderboardView {
  rows: LeaderboardRow[];
  yourRank: LeaderboardRow | null;
  totalPages: number;
}

/**
 * Composed loader shared by the API route and the leaderboards page.
 *
 * hideAdminUsers is threaded in explicitly rather than reloaded from
 * signal_scout_settings here, because every caller already loads settings
 * for its own gate checks (game_enabled, leaderboard_enabled, per-board
 * enabled, require_login) before reaching this function; loading them again
 * here would be a redundant DB round trip on every request.
 */
export async function loadLeaderboardView(
  admin: Client,
  board: Board,
  page: number,
  meId: string | null,
  hideAdminUsers: boolean,
): Promise<LeaderboardView> {
  const etDate = currentEasternGameDate();
  const exclusionIds = await buildExclusionSet(admin, hideAdminUsers);

  // Cache ONLY the shared board page (not auth, not the personal your-rank
  // strip, not the total-pages count), keyed by (board, page, ET date) for
  // CACHE_TTL_SECONDS.
  const cachedBoard = unstable_cache(
    (b: Board, p: number) => queryBoardRows(admin, b, p, exclusionIds, etDate),
    ["signal-scout-leaderboard", etDate],
    { revalidate: CACHE_TTL_SECONDS },
  );
  const rawRows = await cachedBoard(board, page);

  // Resolve display names/avatars via the shared 60-second identity cache
  // (cachedResolveIdentities above): identities are public display data, the
  // same for every viewer, so caching them is safe and caps the per-user
  // auth admin lookup fan-out on every leaderboard view.
  const identityIds = new Set(rawRows.map((row) => row.user_id));
  if (meId) identityIds.add(meId);
  const identities = await cachedResolveIdentities(admin, [...identityIds]);

  const rows = mapRows(board, rawRows, page, meId, identities);

  const yourRank = meId
    ? await computeYourRank(admin, board, meId, exclusionIds, etDate, identities)
    : null;

  // The total-pages count runs OUTSIDE the 60-second cache (unlike the board
  // page above). It is one indexed head:true count, which is cheap, and
  // keeping it live means a user's own newly-scored row extends totalPages
  // immediately instead of waiting out the cache window, so a second cache
  // entry is not worth the staleness it would introduce.
  const totalCount = await countBoardRows(admin, board, exclusionIds, etDate);
  const totalPages = Math.min(Math.max(1, Math.ceil(totalCount / PAGE_SIZE)), MAX_PAGE);

  return { rows, yourRank, totalPages };
}

/**
 * Compact top-PREVIEW_SIZE loader for the "Today's Top Scouts" panel on the
 * game page (plan section 21). Always the daily board, page 1. Reuses
 * queryBoardRows with pageSize=PREVIEW_SIZE so ordering, filtering, and tie
 * breakers stay byte-identical to the full daily board on the leaderboards
 * page; only the row count differs. Identities (including meId, so isYou
 * resolves for the caller's own row) are resolved via the shared 60-second
 * identity cache (cachedResolveIdentities), same as loadLeaderboardView.
 *
 * Never throws to the caller: the preview is non-critical decoration on the
 * game page, so any failure here is logged and swallowed, returning an
 * empty array. The panel renders its own empty-state copy for that case.
 */
export async function loadLeaderboardPreview(
  admin: Client,
  hideAdminUsers: boolean,
  meId: string | null,
): Promise<DailyBoardRow[]> {
  try {
    const etDate = currentEasternGameDate();
    const exclusionIds = await buildExclusionSet(admin, hideAdminUsers);

    const cachedBoard = unstable_cache(
      () => queryBoardRows(admin, "daily", 1, exclusionIds, etDate, PREVIEW_SIZE),
      ["signal-scout-leaderboard-preview", etDate],
      { revalidate: CACHE_TTL_SECONDS },
    );
    const rawRows = (await cachedBoard()) as RawDaily[];

    const identityIds = new Set(rawRows.map((row) => row.user_id));
    if (meId) identityIds.add(meId);
    const identities = await cachedResolveIdentities(admin, [...identityIds]);

    return mapRows("daily", rawRows, 1, meId, identities) as DailyBoardRow[];
  } catch (err) {
    console.error("[signal-scout]", err);
    return [];
  }
}
