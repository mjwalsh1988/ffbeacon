import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { analyzeTrade, type TradeAnalysis } from "@/lib/trade-analyzer";
import type { LeagueContext } from "@/lib/league-format-resolution";
import type { TransactionRowData } from "@/components/transaction-row";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type TransactionFilter = {
  /** "trade" | "waiver" | "free_agent" | "commissioner". null = all. */
  types?: string[];
  /** Sleeper roster_ids. When set, returns only transactions where at least
   * one of these rosters appears in roster_ids. Multi-select. */
  rosterIds?: number[];
  /** Filter by week. null = all. */
  week?: number | null;
  // No season filter — Sleeper's transactions endpoint only returns the
  // league's current season, so the synced rows already share one season.
  /** Pagination. */
  limit?: number;
  offset?: number;
};

export type LoadedTransactions = {
  total: number;
  rows: TransactionRowData[];
};

/**
 * Load transactions for a league with optional filters, resolve every trade
 * into a TradeAnalysis using the supplied LeagueContext, and build the
 * TransactionRowData payload the UI component consumes.
 *
 * `context` may be null when the league has no resolved format (rare —
 * Sleeper league with no canonical format mapping and a source that
 * supports nothing else). When null, trades render without analysis
 * (verdict / values are hidden).
 */
export async function loadLeagueTransactions(
  supabase: AnySupabase,
  leagueRowId: string,
  context: LeagueContext | null,
  filter: TransactionFilter = {},
): Promise<LoadedTransactions> {
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;

  // Build the filtered query. We page via .range() and grab .count('exact')
  // so the UI can render "N of M" + pagination controls.
  let query = (supabase as SupabaseClient<Database>)
    .from("league_transactions")
    .select(
      "id, sleeper_transaction_id, type, status, week, season, adds, drops, draft_picks, waiver_budget, roster_ids, created_at_sleeper",
      { count: "exact" },
    )
    .eq("league_id", leagueRowId)
    .order("created_at_sleeper", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (filter.types && filter.types.length > 0) {
    query = query.in("type", filter.types);
  }
  if (typeof filter.week === "number") {
    query = query.eq("week", filter.week);
  }
  if (filter.rosterIds && filter.rosterIds.length > 0) {
    // roster_ids is a jsonb array column. Use the @> contains operator,
    // OR'd across the requested ids so we match any-of semantics.
    const ors = filter.rosterIds
      .map((id) => `roster_ids.cs.[${id}]`)
      .join(",");
    query = query.or(ors);
  }

  const { data: txRows, count, error } = await query;
  if (error) {
    throw new Error(`load league_transactions failed: ${error.message}`);
  }

  // Roster identity is loaded once per call. Used by both trade analyses
  // and non-trade rows ("via Team X" labels).
  const { data: rosterRows } = await (supabase as SupabaseClient<Database>)
    .from("rosters")
    .select("sleeper_roster_id, owner_user_id")
    .eq("league_id", leagueRowId);
  const { data: userRows } = await (supabase as SupabaseClient<Database>)
    .from("league_users")
    .select("sleeper_user_id, display_name, team_name, avatar")
    .eq("league_id", leagueRowId);

  const userBySleeperId = new Map(userRows?.map((u) => [u.sleeper_user_id, u]) ?? []);
  const rosterIdentities: Record<
    number,
    { teamName: string; ownerHandle: string | null; avatarId: string | null }
  > = {};
  for (const r of rosterRows ?? []) {
    const u = r.owner_user_id ? userBySleeperId.get(r.owner_user_id) : null;
    rosterIdentities[r.sleeper_roster_id] = {
      teamName: u?.team_name || u?.display_name || `Team ${r.sleeper_roster_id}`,
      ownerHandle: u?.display_name ?? null,
      avatarId: u?.avatar ?? null,
    };
  }

  // For non-trade rows we still want names. Collect every sleeper player id
  // referenced across all the loaded rows, resolve them once.
  const allSleeperIds = new Set<string>();
  for (const row of txRows ?? []) {
    const adds = row.adds as Record<string, unknown> | null;
    const drops = row.drops as Record<string, unknown> | null;
    if (adds && typeof adds === "object") {
      for (const id of Object.keys(adds)) {
        if (id && id !== "0") allSleeperIds.add(id);
      }
    }
    if (drops && typeof drops === "object") {
      for (const id of Object.keys(drops)) {
        if (id && id !== "0") allSleeperIds.add(id);
      }
    }
  }
  const playerLookup = await resolvePlayers(supabase, Array.from(allSleeperIds));

  // For each trade row, run the analyzer using the league context.
  const rows: TransactionRowData[] = [];
  for (const r of txRows ?? []) {
    const adds = (r.adds as Record<string, number> | null) ?? null;
    const drops = (r.drops as Record<string, number> | null) ?? null;
    const draftPicks = Array.isArray(r.draft_picks) ? (r.draft_picks as unknown[]) : [];
    const waiverBudget = Array.isArray(r.waiver_budget)
      ? (r.waiver_budget as Array<{ sender: number; receiver: number; amount: number }>)
      : [];

    let analysis: TradeAnalysis | null = null;
    if (r.type === "trade" && context && context.formatConfigId && context.sourceSlug) {
      analysis = await analyzeTrade(supabase, {
        leagueRowId,
        adds,
        draftPicks,
        rosterIdentities,
        context: {
          formatConfigId: context.formatConfigId,
          formatSlug: context.formatSlug,
          formatDisplay: context.formatDisplay,
          sourceSlug: context.sourceSlug,
          sourceDisplay: context.sourceDisplay,
          pickSourceSlug: context.pickSource?.slug ?? null,
          pickSourceDisplay: context.pickSource?.display ?? null,
        },
      });
    }

    rows.push({
      sleeperTransactionId: r.sleeper_transaction_id,
      type: r.type,
      status: r.status ?? null,
      week: r.week ?? null,
      season: r.season ?? null,
      createdAtSleeper: r.created_at_sleeper ?? null,
      adds,
      drops,
      draftPicks,
      waiverBudget,
      playerLookup,
      rosterIdentities,
      analysis,
    });
  }

  return { total: count ?? rows.length, rows };
}

async function resolvePlayers(
  supabase: AnySupabase,
  sleeperIds: string[],
): Promise<Record<string, { name: string; position: string | null; team: string | null }>> {
  const out: Record<string, { name: string; position: string | null; team: string | null }> = {};
  if (sleeperIds.length === 0) return out;
  // Sleeper player IDs are numeric strings. Defense-in-depth: strip
  // anything that isn't, so an untrusted id (a malicious sleeper league
  // could in theory carry oddly-shaped player ids) can't escape the
  // PostgREST filter language we interpolate into below.
  const safeIds = sleeperIds.filter((id) => /^\d+$/.test(id));
  const CHUNK = 200;
  for (let i = 0; i < safeIds.length; i += CHUNK) {
    const chunk = safeIds.slice(i, i + CHUNK);
    const ors = chunk
      .flatMap((id) => [`external_ids->>sleeper.eq.${id}`, `slug.like.*-${id}`])
      .join(",");
    const { data } = await (supabase as SupabaseClient<Database>)
      .from("players")
      .select("slug, full_name, first_name, last_name, position, team, external_ids")
      .or(ors);
    for (const row of data ?? []) {
      const ext = (row.external_ids as Record<string, unknown>) ?? {};
      const fromExternal = typeof ext.sleeper === "string" ? ext.sleeper : null;
      const tail = (row.slug as string).match(/-(\d+)$/)?.[1] ?? null;
      const sid = fromExternal ?? tail;
      if (!sid || !chunk.includes(sid)) continue;
      if (!out[sid]) {
        out[sid] = {
          name:
            row.full_name ?? (`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || sid),
          position: row.position ?? null,
          team: row.team ?? null,
        };
      }
    }
  }
  return out;
}
