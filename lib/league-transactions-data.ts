import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { analyzeTrade, type TradeAnalysis } from "@/lib/trade-analyzer";
import type { LeagueContext } from "@/lib/league-format-resolution";
import { loadLeagueDraftSlots, type LeagueDraftSlotIndex } from "@/lib/league-pick-slots";
import type { StartupPickIndex } from "@/lib/league-startup-picks";
import type { TransactionRowData } from "@/components/transaction-row";
import { resolveSleeperPlayers } from "@/lib/sleeper-player-lookup";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * The feed opens on trades.
 *
 * Trades are what people come to this page to read, and they are the rows that
 * carry a graded verdict; waivers and free-agent adds are the long tail that
 * buries them. So "no type in the URL" means trades, and ALL_TYPES_SENTINEL is
 * the explicit escape hatch the filter bar writes when every type is
 * deselected. Without that sentinel there would be no way to express "show
 * everything", because an empty selection is exactly what the default fills in.
 */
export const DEFAULT_TYPE_FILTER = "trade";
export const ALL_TYPES_SENTINEL = "all";

export type TransactionFilter = {
  /** "trade" | "waiver" | "free_agent" | "commissioner". null = all. */
  types?: string[];
  /** Sleeper roster_ids. When set, returns only transactions where at least
   * one of these rosters appears in roster_ids. Multi-select. */
  rosterIds?: number[];
  /** Filter by week. null = all. */
  week?: number | null;
  // No season filter, Sleeper's transactions endpoint only returns the
  // league's current season, so the synced rows already share one season.
  /** Pagination. */
  limit?: number;
  offset?: number;
};

export type RosterIdentities = Record<
  number,
  { teamName: string; ownerHandle: string | null; avatarId: string | null }
>;

export type LoadedTransactions = {
  total: number;
  /** Rows carry `analysis: null`. See loadTradeAnalyses. */
  rows: TransactionRowData[];
  /** Reused by loadTradeAnalyses so it does not re-read either. */
  rosterIdentities: RosterIdentities;
  slotIndex: LeagueDraftSlotIndex;
};

/**
 * Load transactions for a league with optional filters and build the
 * TransactionRowData payload the UI component consumes.
 *
 * Trade VALUATION is deliberately not done here. Every trade the page can grade
 * renders through SignalCheckTradeCard, which never reads `analysis`, so running
 * the analyzer up front meant computing a full valuation per trade and throwing
 * all of it away. On a 25-row page of one real league that was 1.6 seconds of
 * the load, in a sequential await loop. The caller now grades first and asks for
 * analyses only for the trades Signal Check could not take, via
 * loadTradeAnalyses.
 */
export async function loadLeagueTransactions(
  supabase: AnySupabase,
  leagueRowId: string,
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
  const [{ data: rosterRows }, { data: userRows }, slotIndex] = await Promise.all([
    (supabase as SupabaseClient<Database>)
      .from("rosters")
      .select("sleeper_roster_id, owner_user_id")
      .eq("league_id", leagueRowId),
    (supabase as SupabaseClient<Database>)
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name, avatar")
      .eq("league_id", leagueRowId),
    loadLeagueDraftSlots(supabase, leagueRowId),
  ]);

  const userBySleeperId = new Map(userRows?.map((u) => [u.sleeper_user_id, u]) ?? []);
  const rosterIdentities: RosterIdentities = {};
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
  const playerLookup = await resolveSleeperPlayers(supabase, Array.from(allSleeperIds));

  const rows: TransactionRowData[] = [];
  for (const r of txRows ?? []) {
    const adds = (r.adds as Record<string, number> | null) ?? null;
    const drops = (r.drops as Record<string, number> | null) ?? null;
    const draftPicks = Array.isArray(r.draft_picks) ? (r.draft_picks as unknown[]) : [];
    const waiverBudget = Array.isArray(r.waiver_budget)
      ? (r.waiver_budget as Array<{ sender: number; receiver: number; amount: number }>)
      : [];

    // Stamp pick_label on each raw draft pick for the non-trade MovesBody
    // renderer. The trade analyzer attaches its own label, so this branch
    // exists for waivers / commissioner moves that occasionally include picks.
    const enrichedDraftPicks = draftPicks.map((raw) => {
      if (!raw || typeof raw !== "object") return raw;
      const p = raw as Record<string, unknown>;
      const season =
        typeof p.season === "number"
          ? p.season
          : typeof p.season === "string"
            ? parseInt(p.season, 10)
            : NaN;
      const round = typeof p.round === "number" ? p.round : Number(p.round);
      const originalRosterId =
        typeof p.roster_id === "number"
          ? p.roster_id
          : typeof p.previous_owner_id === "number"
            ? p.previous_owner_id
            : null;
      if (!Number.isFinite(season) || !Number.isFinite(round) || originalRosterId == null) {
        return raw;
      }
      const label = slotIndex.labelFor(season, originalRosterId, round);
      return label && !p.pick_label ? { ...p, pick_label: label } : raw;
    });

    rows.push({
      sleeperTransactionId: r.sleeper_transaction_id,
      type: r.type,
      status: r.status ?? null,
      week: r.week ?? null,
      season: r.season ?? null,
      createdAtSleeper: r.created_at_sleeper ?? null,
      adds,
      drops,
      draftPicks: enrichedDraftPicks,
      waiverBudget,
      playerLookup,
      rosterIdentities,
      analysis: null,
    });
  }

  return { total: count ?? rows.length, rows, rosterIdentities, slotIndex };
}

/**
 * Value the trades the caller asks for, all at once.
 *
 * Only the trades Signal Check could not grade need this, which is normally
 * none of them, and the work runs concurrently rather than in a queue: the old
 * sequential loop made a page of trades cost the sum of every valuation.
 *
 * Returns a map keyed by sleeper_transaction_id. A trade that throws is simply
 * absent, so one bad row degrades to the plain adds/drops layout instead of
 * failing the feed.
 *
 * The startup-pick index is NOT built here. `draft_selections` is service-role
 * only (migration 0188 gives it no anon or authenticated policy) and this
 * function is called with the page's user-scoped client, so building one here
 * read zero selection rows every time and then told the reader that every
 * startup pick was "not loaded yet" when the truth is that this client may not
 * read them. The caller passes the index `analyzeLeagueTrades` already built
 * with the admin client, which is one honest answer and two fewer queries.
 */
export async function loadTradeAnalyses(
  supabase: AnySupabase,
  leagueRowId: string,
  context: LeagueContext | null,
  rows: TransactionRowData[],
  loaded: Pick<LoadedTransactions, "rosterIdentities" | "slotIndex">,
  startupIndex: StartupPickIndex | null = null,
): Promise<Map<string, TradeAnalysis>> {
  const out = new Map<string, TradeAnalysis>();
  if (!context?.formatConfigId || !context.sourceSlug) return out;
  const trades = rows.filter((r) => r.type === "trade");
  if (trades.length === 0) return out;

  const analyzerContext = {
    formatConfigId: context.formatConfigId,
    formatSlug: context.formatSlug,
    formatDisplay: context.formatDisplay,
    sourceSlug: context.sourceSlug,
    sourceDisplay: context.sourceDisplay,
    pickSourceSlug: context.pickSource?.slug ?? null,
    pickSourceDisplay: context.pickSource?.display ?? null,
  };

  await Promise.all(
    trades.map(async (r) => {
      try {
        const analysis = await analyzeTrade(supabase, {
          leagueRowId,
          adds: r.adds,
          draftPicks: r.draftPicks,
          rosterIdentities: loaded.rosterIdentities,
          slotIndex: loaded.slotIndex,
          startupIndex,
          tradedAtSleeper: r.createdAtSleeper,
          context: analyzerContext,
        });
        if (analysis) out.set(r.sleeperTransactionId, analysis);
      } catch (err) {
        console.error("[transactions] trade analysis failed", r.sleeperTransactionId, err);
      }
    }),
  );

  return out;
}

