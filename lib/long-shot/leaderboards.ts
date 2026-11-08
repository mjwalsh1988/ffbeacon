/**
 * Long Shot boards (plan 13), modeled on lib/signal-scout/leaderboards.ts:
 * PAGE_SIZE 25, MAX_PAGE 200, a 60-second unstable_cache on the shared
 * page, the same exclusion set (hidden users plus admins when
 * hide_admin_users is on), page-aware ranks and a your-rank strip.
 *
 * Hurry-Up data only. Three boards:
 *   daily    completed attempts for a date, total_points desc, completed_at asc
 *   all_time stats, total_points desc, days_played desc, first_completed_at asc
 *   streak   stats, current_streak desc, best_streak desc, first_completed_at asc
 *
 * Cache keys: the daily board keys on the REQUESTED date, so yesterday's
 * request never serves today's rows; all_time and streak key on today so
 * they roll at midnight. The exclusion set is read outside the cache and
 * passed as an argument, which puts it in the key and makes a hide take
 * effect within the TTL. Raw user ids never leave this module.
 */

import { unstable_cache } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { resolveUserIdentities, scoutFallbackLabel, type ResolvedUserIdentity } from "@/lib/user-identity";
import { profileHrefFor, resolveLiveProfileHandles } from "./profile-links";
import { dailyRank, inList, loadExclusionSet } from "./rank";
import type { LongShotSettings } from "./types";

type Client = SupabaseClient<Database>;

export type Board = "daily" | "all_time" | "streak";
export const boardSchema = z.enum(["daily", "all_time", "streak"]);

export const PAGE_SIZE = 25;
export const MAX_PAGE = 200;
export const CACHE_TTL_SECONDS = 60;

export interface BoardRow {
  rank: number;
  name: string;
  avatarUrl: string | null;
  isYou: boolean;
  profileHref: string | null;
  /** The board's headline figure: points for daily and all_time, the current streak for streak. */
  figure: number;
  /** A second figure: days played (all_time), best streak (streak), bonus points (daily). */
  secondary: number;
}

export interface LeaderboardView {
  board: Board;
  page: number;
  date: string;
  rows: BoardRow[];
  yourRank: BoardRow | null;
  totalPages: number;
  /**
   * True when the reader is in the exclusion set (hidden by moderation, or an
   * admin while hide_admin_users is on): their rank is computed and shown to
   * them, but their row is never in `rows`, and the panel says so.
   */
  viewerHidden: boolean;
}

export interface RawBoardRow {
  user_id: string;
  figure: number;
  secondary: number;
}

/** Pure: the cache key parts for a board request. */
export function boardCacheKey(board: Board, requestedDate: string, today: string): string[] {
  return ["long-shot-leaderboard", board, board === "daily" ? requestedDate : today];
}

interface Excludable {
  not: (c: string, op: string, v: string) => Excludable;
}
function applyExclusion<T extends Excludable>(q: T, ids: readonly string[]): T {
  return ids.length === 0 ? q : (q.not("user_id", "in", inList(ids)) as T);
}

export async function queryBoardRows(
  admin: Client,
  board: Board,
  page: number,
  date: string,
  excluded: readonly string[],
): Promise<RawBoardRow[]> {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  if (board === "daily") {
    const base = admin
      .from("long_shot_attempts")
      .select("user_id, total_points, bonus_points")
      .eq("game_date", date)
      .eq("mode", "hurry_up")
      .eq("status", "completed")
      .order("total_points", { ascending: false })
      .order("completed_at", { ascending: true })
      .order("id", { ascending: true });
    const { data, error } = await applyExclusion(base, excluded).range(from, to);
    if (error) throw new Error(`daily board read failed: ${error.message}`);
    return (data ?? []).map((r) => ({ user_id: r.user_id, figure: r.total_points, secondary: r.bonus_points }));
  }
  const ordered =
    board === "all_time"
      ? admin
          .from("long_shot_user_stats")
          .select("user_id, total_points, days_played, current_streak, best_streak")
          .eq("hidden_from_leaderboards", false)
          .gt("days_played", 0)
          .order("total_points", { ascending: false })
          .order("days_played", { ascending: false })
          .order("first_completed_at", { ascending: true })
          .order("user_id", { ascending: true })
      : admin
          .from("long_shot_user_stats")
          .select("user_id, total_points, days_played, current_streak, best_streak")
          .eq("hidden_from_leaderboards", false)
          .gt("current_streak", 0)
          .order("current_streak", { ascending: false })
          .order("best_streak", { ascending: false })
          .order("first_completed_at", { ascending: true })
          .order("user_id", { ascending: true });
  const { data, error } = await applyExclusion(ordered, excluded).range(from, to);
  if (error) throw new Error(`${board} board read failed: ${error.message}`);
  return (data ?? []).map((r) =>
    board === "all_time"
      ? { user_id: r.user_id, figure: r.total_points, secondary: r.days_played }
      : { user_id: r.user_id, figure: r.current_streak, secondary: r.best_streak },
  );
}

async function countBoardRows(admin: Client, board: Board, date: string, excluded: readonly string[]): Promise<number> {
  const base =
    board === "daily"
      ? admin
          .from("long_shot_attempts")
          .select("id", { count: "exact", head: true })
          .eq("game_date", date)
          .eq("mode", "hurry_up")
          .eq("status", "completed")
      : admin
          .from("long_shot_user_stats")
          .select("user_id", { count: "exact", head: true })
          .eq("hidden_from_leaderboards", false)
          .gt(board === "all_time" ? "days_played" : "current_streak", 0);
  const { count, error } = await applyExclusion(base, excluded);
  if (error) throw new Error(`board count failed: ${error.message}`);
  return count ?? 0;
}

export async function cachedResolveIdentities(admin: Client, ids: string[]): Promise<Map<string, ResolvedUserIdentity>> {
  const sorted = [...new Set(ids)].sort();
  const cached = unstable_cache(
    async (s: string[]) => [...(await resolveUserIdentities(admin, s, "public")).entries()],
    ["long-shot-identities"],
    { revalidate: CACHE_TTL_SECONDS },
  );
  return new Map(await cached(sorted));
}

/** Pure: raw rows to public rows. Raw user ids never appear in the output. */
export function mapRows(
  raw: readonly RawBoardRow[],
  page: number,
  meId: string | null,
  identities: ReadonlyMap<string, ResolvedUserIdentity>,
  handles: ReadonlyMap<string, string>,
): BoardRow[] {
  const offset = (page - 1) * PAGE_SIZE;
  return raw.map((r, i) => {
    const identity = identities.get(r.user_id) ?? { displayName: scoutFallbackLabel(r.user_id), avatarUrl: null };
    return {
      rank: offset + i + 1,
      name: identity.displayName,
      avatarUrl: identity.avatarUrl,
      isYou: meId !== null && r.user_id === meId,
      profileHref: profileHrefFor(handles, r.user_id),
      figure: r.figure,
      secondary: r.secondary,
    };
  });
}

async function yourRow(
  admin: Client,
  board: Board,
  date: string,
  meId: string,
  excluded: readonly string[],
): Promise<RawBoardRow & { rank: number } | null> {
  if (board === "daily") {
    const { data, error } = await admin
      .from("long_shot_attempts")
      .select("total_points, bonus_points, completed_at")
      .eq("game_date", date)
      .eq("mode", "hurry_up")
      .eq("status", "completed")
      .eq("user_id", meId)
      .maybeSingle();
    if (error) throw new Error(`your daily row failed: ${error.message}`);
    if (!data?.completed_at) return null;
    const rank = await dailyRank(admin, date, data.total_points, data.completed_at, excluded);
    return { user_id: meId, figure: data.total_points, secondary: data.bonus_points, rank };
  }
  const { data, error } = await admin
    .from("long_shot_user_stats")
    .select("total_points, days_played, current_streak, best_streak")
    .eq("user_id", meId)
    .maybeSingle();
  if (error) throw new Error(`your stats row failed: ${error.message}`);
  if (!data) return null;
  const figure = board === "all_time" ? data.total_points : data.current_streak;
  if (figure <= 0 && board === "streak") return null;
  const col = board === "all_time" ? "total_points" : "current_streak";
  const { count, error: cErr } = await applyExclusion(
    admin
      .from("long_shot_user_stats")
      .select("user_id", { count: "exact", head: true })
      .eq("hidden_from_leaderboards", false)
      .gt(col, figure),
    excluded,
  );
  if (cErr) throw new Error(`your rank count failed: ${cErr.message}`);
  return {
    user_id: meId,
    figure,
    secondary: board === "all_time" ? data.days_played : data.best_streak,
    rank: (count ?? 0) + 1,
  };
}

export async function loadLeaderboardView(
  admin: Client,
  settings: LongShotSettings,
  board: Board,
  page: number,
  requestedDate: string,
  today: string,
  meId: string | null,
): Promise<LeaderboardView> {
  const excluded = await loadExclusionSet(admin, settings);
  const cachedBoard = unstable_cache(
    (p: number, ex: string[]) => queryBoardRows(admin, board, p, requestedDate, ex),
    boardCacheKey(board, requestedDate, today),
    { revalidate: CACHE_TTL_SECONDS },
  );
  const raw = await cachedBoard(page, excluded);
  const ids = raw.map((r) => r.user_id);
  if (meId) ids.push(meId);
  const [identities, handles, mine, total] = await Promise.all([
    cachedResolveIdentities(admin, ids),
    resolveLiveProfileHandles(admin, ids),
    meId ? yourRow(admin, board, requestedDate, meId, excluded) : Promise.resolve(null),
    countBoardRows(admin, board, requestedDate, excluded),
  ]);
  const rows = mapRows(raw, page, meId, identities, handles);
  const yourRank = mine ? { ...mapRows([mine], 1, meId, identities, handles)[0], rank: mine.rank } : null;
  return {
    board,
    page,
    date: requestedDate,
    rows,
    yourRank,
    totalPages: Math.min(Math.max(1, Math.ceil(total / PAGE_SIZE)), MAX_PAGE),
    viewerHidden: meId !== null && excluded.includes(meId),
  };
}
