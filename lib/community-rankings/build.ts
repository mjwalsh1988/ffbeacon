import "server-only";

/**
 * The nightly community rankings build (plan section 9, step 32).
 *
 * For every ACTIVE format: read the boards that count, turn each into its
 * head-to-head statements against its own pool, fit one Bradley-Terry model,
 * rank, and REPLACE the format's rows in community_rankings. It iterates
 * formats; the only per-board work is paging the board rows it needs.
 *
 * THE POOL of a board is the seed source's ranked set for the board's format
 * and scope:
 *   - offense scopes: the current season-long rankings of the board's stored
 *     seed source when that source is active, publishes rankings and covers
 *     the format, else the site default through resolveSourceForFormat,
 *     filtered to the scope's positions;
 *   - defender scopes: the defender seed order (loadDefenderSeed);
 *   - overall with defenders: the offense pool, then the defender pool.
 *
 * Writes only community_rankings and community_ranking_formats.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllRows, fetchAllRowsInChunks } from "@/lib/supabase/fetch-all";
import { getActiveFormats, getAvailableSources, resolveSourceForFormat } from "@/lib/source";
import { scopePositions, type BoardScope } from "@/lib/ranking-boards";
import type { RankingBuilderSettings } from "@/lib/ranking-boards/default-settings";
import { loadDefenderSeed } from "@/lib/ranking-boards/seed";
import { isDefender } from "@/lib/site";
import { eligibleBoardsByFormat, isFormatPublished, type RawCommunityBoard } from "./eligibility";
import { addBoard, createAggregate } from "./statements";
import { fitBradleyTerry } from "./fit";
import { rankCommunity } from "./rank";

type Client = SupabaseClient<Database>;

const MAX_RANKING_ROWS = 20_000;

export type CommunityFormatSummary = {
  formatConfigId: string;
  formatSlug: string;
  eligibleBoards: number;
  /** Distinct accounts behind the counted boards; the publish threshold. */
  eligibleAccounts: number;
  published: boolean;
  playersListed: number;
  groups: string[];
  iterations: number;
};

export type CommunityBuildOptions = {
  /** Skip Next's data cache for the defender seed. For scripts, which run
   * outside a Next request where unstable_cache has nothing to use. */
  uncachedSeeds?: boolean;
};

type BoardRow = RawCommunityBoard & {
  seedSourceSlug: string | null;
  leftOff: string[];
};

type PoolPlayer = { playerId: string; position: string };

export async function buildCommunityRankings(
  admin: Client,
  settings: RankingBuilderSettings,
  now: Date,
  opts: CommunityBuildOptions = {},
): Promise<CommunityFormatSummary[]> {
  const community = settings.community;
  const builtAt = now.toISOString();
  const [formats, registry] = await Promise.all([getActiveFormats(admin), getAvailableSources(admin)]);

  const boardRows = await fetchAllRows("community boards", (from, to) =>
    admin
      .from("user_ranking_boards")
      .select(
        "id, user_id, scope, includes_defenders, format_config_id, community_opt_out, updated_at, seed_source_slug, left_off_player_ids",
      )
      .eq("community_opt_out", false)
      .not("format_config_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );

  // Ordered player ids per candidate board, one paged read for all of them.
  const orderByBoard = new Map<string, Array<{ playerId: string; rank: number; id: string }>>();
  const boardPlayers = await fetchAllRowsInChunks(
    "community board players",
    boardRows.map((b) => b.id),
    (chunk, from, to) =>
      admin
        .from("user_ranking_board_players")
        .select("id, board_id, player_id, rank_position")
        .in("board_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
  );
  for (const row of boardPlayers) {
    const list = orderByBoard.get(row.board_id);
    const entry = { playerId: row.player_id, rank: row.rank_position, id: row.id };
    if (list) list.push(entry);
    else orderByBoard.set(row.board_id, [entry]);
  }
  for (const list of orderByBoard.values()) {
    list.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const raw: BoardRow[] = boardRows.map((b) => ({
    id: b.id,
    userId: b.user_id,
    scope: b.scope,
    includesDefenders: b.includes_defenders,
    formatConfigId: b.format_config_id,
    optOut: b.community_opt_out,
    updatedAt: b.updated_at,
    playerCount: orderByBoard.get(b.id)?.length ?? 0,
    seedSourceSlug: b.seed_source_slug,
    leftOff: b.left_off_player_ids ?? [],
  }));
  const { boards: counted, countsByFormat, accountsByFormat } = eligibleBoardsByFormat(raw, community);

  // Pools are shared across boards: one rankings read per (source, format),
  // one defender seed per position set.
  const rankingsCache = new Map<string, Promise<PoolPlayer[]>>();
  const loadRankings = (source: string, formatId: string): Promise<PoolPlayer[]> => {
    const key = `${source}|${formatId}`;
    let hit = rankingsCache.get(key);
    if (!hit) {
      hit = readRankings(admin, source, formatId);
      rankingsCache.set(key, hit);
    }
    return hit;
  };
  const defenderCache = new Map<string, Promise<PoolPlayer[]>>();
  const loadDefenders = (positions: readonly string[]): Promise<PoolPlayer[]> => {
    const key = [...positions].sort().join(",");
    let hit = defenderCache.get(key);
    if (!hit) {
      hit = loadDefenderSeed(positions, { uncached: opts.uncachedSeeds === true }).then((seed) =>
        seed.players.map((p) => ({ playerId: p.playerId, position: p.position })),
      );
      defenderCache.set(key, hit);
    }
    return hit;
  };

  const summaries: CommunityFormatSummary[] = [];
  for (const format of formats) {
    const formatBoards = counted.filter((b) => b.formatConfigId === format.id);
    const eligible = countsByFormat.get(format.id) ?? 0;
    const eligibleAccounts = accountsByFormat.get(format.id) ?? 0;
    const positions = new Map<string, string>();
    const agg = createAggregate();

    for (const board of formatBoards) {
      const scope = board.scope as BoardScope;
      const allowed = scopePositions(scope, scope === "overall" && board.includesDefenders);
      const offensePositions = allowed.filter((p) => !isDefender(p));
      const defenderPositions = allowed.filter((p) => isDefender(p));

      const pool: PoolPlayer[] = [];
      if (offensePositions.length > 0) {
        const resolution = resolveSourceForFormat(registry, "rankings", format.slug, board.seedSourceSlug);
        if (resolution.source) {
          const wanted = new Set(offensePositions);
          for (const p of await loadRankings(resolution.source, format.id)) {
            if (wanted.has(p.position)) pool.push(p);
          }
        }
      }
      if (defenderPositions.length > 0) {
        pool.push(...(await loadDefenders(defenderPositions)));
      }
      for (const p of pool) if (!positions.has(p.playerId)) positions.set(p.playerId, p.position);

      addBoard(
        agg,
        {
          playerIds: (orderByBoard.get(board.id) ?? []).map((e) => e.playerId),
          leftOff: board.leftOff,
          pool: pool.map((p) => p.playerId),
        },
        community,
      );
    }

    // Positions for anyone on a board but outside every pool.
    const missingSet = new Set<string>();
    for (const id of agg.boardsCount.keys()) if (!positions.has(id)) missingSet.add(id);
    for (const row of agg.wins.values()) {
      for (const id of row.keys()) if (!positions.has(id)) missingSet.add(id);
    }
    const missing = [...missingSet].sort();
    if (missing.length > 0) {
      const players = await fetchAllRowsInChunks("community player positions", missing, (chunk, from, to) =>
        admin
          .from("players")
          .select("id, position")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      );
      for (const p of players) positions.set(p.id, p.position);
    }

    const fit = fitBradleyTerry(agg.wins, positions, { shrinkage: community.shrinkage });

    const previous = await fetchAllRows("community previous ranks", (from, to) =>
      admin
        .from("community_rankings")
        .select("player_id, overall_rank")
        .eq("format_config_id", format.id)
        .order("player_id", { ascending: true })
        .range(from, to),
    );
    const previousRanks = new Map(previous.map((r) => [r.player_id, r.overall_rank]));

    const rows = rankCommunity({
      fit: fit.players,
      positions,
      boardsCount: agg.boardsCount,
      minBoardsPerPlayer: community.minBoardsPerPlayer,
      previousRanks,
    });
    const groups = [...new Set(rows.map((r) => r.group))];

    const { data: oldFormat, error: oldFormatError } = await admin
      .from("community_ranking_formats")
      .select("built_at")
      .eq("format_config_id", format.id)
      .maybeSingle();
    if (oldFormatError) throw new Error(`community formats read failed: ${oldFormatError.message}`);

    // An unpublished format keeps NO public rows: the call below passes an
    // empty set, which also clears whatever an earlier build left. The format
    // row is still written, so its page can say how far off it is.
    const published = isFormatPublished(eligibleAccounts, community.minBoardsToPublish);
    const written = published ? rows : [];
    const listedGroups = published ? groups : [];
    const payload = written.map((r) => ({
      player_id: r.playerId,
      position: r.position,
      strength: r.strength,
      overall_rank: r.overallRank,
      position_rank: r.positionRank,
      previous_rank: r.previousRank,
      boards_count: r.boardsCount,
      group_key: r.group,
      built_at: builtAt,
    }));

    // One transaction: delete, insert and the format row land together or not
    // at all, so a reader never sees an empty or half-written list.
    const { error: replaceError } = await admin.rpc("replace_community_rankings", {
      p_format_config_id: format.id,
      p_rows: payload,
      p_format: {
        eligible_boards: eligible,
        eligible_accounts: eligibleAccounts,
        published,
        players_listed: written.length,
        groups: listedGroups,
        built_at: builtAt,
        previous_built_at: oldFormat?.built_at ?? null,
      },
    });
    if (replaceError) throw new Error(`community rankings replace failed: ${replaceError.message}`);

    summaries.push({
      formatConfigId: format.id,
      formatSlug: format.slug,
      eligibleBoards: eligible,
      eligibleAccounts,
      published,
      playersListed: written.length,
      groups: listedGroups,
      iterations: fit.iterations,
    });
  }
  return summaries;
}

/** One source's current season-long rankings for one format, in overall-rank
 * order. The same read as lib/ranking-boards/seed.ts, without Next's cache. */
async function readRankings(admin: Client, source: string, formatId: string): Promise<PoolPlayer[]> {
  const rows = await fetchAllRows(
    "community pool rankings",
    (from, to) =>
      admin
        .from("rankings")
        .select("id, overall_rank, players!inner(id, position)")
        .eq("format_config_id", formatId)
        .eq("source", source)
        .is("week", null)
        .order("overall_rank", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { maxRows: MAX_RANKING_ROWS },
  );
  return rows.map((row) => {
    const p = row.players as unknown as { id: string; position: string };
    return { playerId: p.id, position: p.position };
  });
}
