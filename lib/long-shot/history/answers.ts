/**
 * The history pool as the game sees it (plan 31.3): which id a historical
 * person answers under, their prominence for tiering, and the typeahead
 * search over history_players.
 *
 * THE ID RULE. A person linked to a players row that is in the modern search
 * pool answers under that players.id, so the roster rate tiers them and the
 * ordinary search finds them. Everyone else answers under their
 * history_players.id. The search route applies the same rule, so the id a
 * reader can pick is always the id the prompt holds.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { memoTtl } from "@/lib/memo-ttl";
import type { SearchPlayerResult } from "@/components/player-guess-combobox";
import { franchiseByKey } from "./franchises";

type Client = SupabaseClient<Database>;

export interface HistoryRef {
  id: string;
  player_id: string | null;
}

/** Pure: see the id rule above. Distinct, first-seen order. */
export function historyAnswerIds(rows: readonly HistoryRef[], modernPool: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const r of rows) out.add(r.player_id && modernPool.has(r.player_id) ? r.player_id : r.id);
  return Array.from(out);
}

/** The Unicode combining marks block (U+0300 to U+036F), built from codes so the file stays ASCII. */
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/** Pure: lower case, no accents or punctuation, single spaces. Applied at write and at query. */
export function normalizeSearchName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pure: "QB, 1963 to 1974, Raiders" for the picker's note. */
export function historyNote(row: { first_season: number; last_season: number; franchise_keys: string[] }): string {
  const years = row.first_season === row.last_season ? String(row.first_season) : `${row.first_season} to ${row.last_season}`;
  const teams = row.franchise_keys
    .map((k) => franchiseByKey(k)?.short)
    .filter((x): x is string => Boolean(x))
    .slice(0, 2);
  return teams.length > 0 ? `${years}, ${teams.join(" and ")}` : years;
}

const READY_TTL_MS = 5 * 60 * 1000;

/** True when the pool has been synced at least once. Memoised for five minutes. */
export async function historyReady(admin: Client): Promise<boolean> {
  return memoTtl("ref:long-shot-history-ready", READY_TTL_MS, async () => {
    const { count, error } = await admin.from("history_players").select("id", { count: "exact", head: true });
    if (error) throw new Error(`history ready check failed: ${error.message}`);
    return (count ?? 0) > 0;
  });
}

/** Every history id, so the generator's typeable check accepts them. Memoised. */
export async function historyIdPool(admin: Client): Promise<Set<string>> {
  return memoTtl("ref:long-shot-history-pool", READY_TTL_MS, async () => {
    const rows = await fetchAllRows<{ id: string }>("long shot history pool", (from, to) =>
      admin.from("history_players").select("id").order("id", { ascending: true }).range(from, to),
    );
    return new Set(rows.map((r) => r.id));
  });
}

const CHUNK = 200;

/** history id -> prominence, for ids that are history ids; others are absent. */
export async function loadHistoryProminence(admin: Client, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await admin
      .from("history_players")
      .select("id, prominence")
      .in("id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`history prominence read failed: ${error.message}`);
    for (const r of data ?? []) out.set(r.id, Number(r.prominence));
  }
  return out;
}

/**
 * players.id -> prominence and whether the players row still has a team, for
 * linked people, so a retired player who still answers under his players.id
 * (a stat line since 2020) is tiered by how well known he is rather than by a
 * roster rate of zero or of one stale league.
 */
export async function loadLinkedProminence(
  admin: Client,
  playerIds: readonly string[],
): Promise<Map<string, { prominence: number; hasTeam: boolean }>> {
  const out = new Map<string, { prominence: number; hasTeam: boolean }>();
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const { data, error } = await admin
      .from("history_players")
      .select("player_id, prominence, players!inner(team)")
      .in("player_id", playerIds.slice(i, i + CHUNK));
    if (error) throw new Error(`linked prominence read failed: ${error.message}`);
    for (const r of data ?? []) {
      const team = (r.players as unknown as { team: string | null } | null)?.team ?? null;
      if (r.player_id) out.set(r.player_id, { prominence: Number(r.prominence), hasTeam: Boolean(team && team !== "FA") });
    }
  }
  return out;
}

export interface HistoryInfo {
  name: string;
  note: string;
}

/** Names for history ids the players table did not know. */
export async function loadHistoryInfo(admin: Client, ids: readonly string[]): Promise<Map<string, HistoryInfo>> {
  const out = new Map<string, HistoryInfo>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await admin
      .from("history_players")
      .select("id, full_name, first_season, last_season, franchise_keys")
      .in("id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`history info read failed: ${error.message}`);
    for (const r of data ?? []) out.set(r.id, { name: r.full_name, note: historyNote(r) });
  }
  return out;
}

/** True when the id is a players row or a history row. */
export async function playerIdExists(admin: Client, id: string): Promise<boolean> {
  const modern = await admin.from("players").select("id").eq("id", id).maybeSingle();
  if (modern.error) throw new Error(`player existence read failed: ${modern.error.message}`);
  if (modern.data) return true;
  const hist = await admin.from("history_players").select("id").eq("id", id).maybeSingle();
  if (hist.error) throw new Error(`history existence read failed: ${hist.error.message}`);
  return Boolean(hist.data);
}

const SEARCH_PAGE = 25;
const SEARCH_PAGES = 4;

/**
 * Typeahead over the history pool: name matches at the game's positions,
 * most prominent first, excluding people the modern search already returns
 * (linked and in the modern pool). The exclusion runs here, so the read is
 * paged until `limit` survivors are found or the matches run out (a common
 * surname's most prominent rows are mostly linked modern players, exactly the
 * ones excluded). The caller merges and caps.
 */
export async function searchHistoryPlayers(
  admin: Client,
  query: string,
  limit: number,
  modernPool: ReadonlySet<string>,
): Promise<SearchPlayerResult[]> {
  const q = normalizeSearchName(query);
  if (!q || limit <= 0) return [];
  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const out: SearchPlayerResult[] = [];
  for (let page = 0; page < SEARCH_PAGES && out.length < limit; page++) {
    const from = page * SEARCH_PAGE;
    const { data, error } = await admin
      .from("history_players")
      .select("id, full_name, position, first_season, last_season, franchise_keys, player_id")
      .ilike("search_name", `%${escaped}%`)
      .in("position", ["QB", "RB", "WR", "TE"])
      .order("prominence", { ascending: false })
      .order("full_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + SEARCH_PAGE - 1);
    if (error) throw new Error(`history search failed: ${error.message}`);
    for (const r of data ?? []) {
      if (out.length >= limit) break;
      if (r.player_id && modernPool.has(r.player_id)) continue;
      out.push({ id: r.id, name: r.full_name, position: r.position, team: null, sleeperId: null, note: historyNote(r) });
    }
    if ((data?.length ?? 0) < SEARCH_PAGE) break;
  }
  return out;
}
