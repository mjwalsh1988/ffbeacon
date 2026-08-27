/**
 * The Draft Tracker board loader: every draftable player for one format, with
 * the three numbers the three orderings need (value, Sleeper ADP, and the name
 * itself) already attached.
 *
 * WHY THIS IS NOT loadRankedBoard. On The Clock forces the FF Beacon source and
 * carries a lot the tracker has no use for: Beacon Steals, pick buckets, ages,
 * rookie flags. The tracker respects the reader's own source choice and ships
 * the smallest row it can, because the whole list crosses to the browser at once
 * (see the note on caching below).
 *
 * WHY THE WHOLE LIST CROSSES AT ONCE. This is a list somebody reads while a
 * draft is happening in a room, on a phone, on whatever the venue calls wifi. A
 * server round-trip per keystroke or per page is the wrong trade there, so the
 * board is loaded once and every search, filter, and re-order after that is
 * arithmetic in the browser. Measured, the largest format is 799 players and 25
 * kB brotli, which is a fifth of what the headshots on the first screenful cost.
 *
 * CACHING, in two layers. The board for a (format, source) goes through the Next
 * data cache keyed on that pair, on the hourly TTL and the player-values tag.
 * The ADP map underneath it is cached separately on the format alone, because it
 * does not depend on the source at all: without that split, four sources on one
 * format would each pay the same 1,600-row market read.
 *
 * What is NOT cached is the reader's own picks. Those change the moment a button
 * is pressed, and a cached pick list would put a drafted player back on the board.
 */

import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { adpFormatKeyCandidates } from "@/lib/on-the-clock/adp";
import { normalizePositionColor } from "@/lib/on-the-clock/position-colors";
import { buildSortName } from "./order";
import type { DraftTrackerBoard, TrackerPlayer } from "./types";

/**
 * How deep the board goes. Sources rank roughly 500 to 900 players per format,
 * so this is headroom rather than a real cut: it exists to stop a misconfigured
 * source shipping the world to a phone.
 */
const BOARD_LIMIT = 900;

/** PostgREST returns at most 1000 rows per request, so every read here pages. */
const PAGE = 1000;

/** The Sleeper market rows live under this source slug. */
const MARKET_SOURCE = "sleeper";

function readSleeperId(externalIds: unknown): string | null {
  if (!externalIds || typeof externalIds !== "object") return null;
  const value = (externalIds as Record<string, unknown>).sleeper;
  if (typeof value === "string" && value) return value;
  if (typeof value === "number") return String(value);
  return null;
}

type RankingRow = {
  overall_rank: number;
  position_rank: number;
  tier: number | null;
  players: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    position: string | null;
    team: string | null;
    external_ids: unknown;
  };
};

type AdpMap = { key: string | null; date: string | null; map: Record<string, number> };

/**
 * The Sleeper ADP map for a format, as { sleeperPlayerId: adp }.
 *
 * Candidate keys come from the same mapping On The Clock grades picks against
 * (lib/on-the-clock/adp.ts), so a dynasty superflex draft is priced against the
 * dynasty superflex market and never against a redraft one. The first candidate
 * with rows wins; a format whose market is missing entirely returns an empty map
 * and the UI says the column has no data rather than showing zeroes.
 *
 * Only the one key is selected out of the `adp` jsonb. Measured, the whole
 * object across the dynasty superflex market is 107 kB to read one number per
 * row; the projection cuts that to about 10 kB.
 */
async function loadAdpMap(formatSlug: string): Promise<AdpMap> {
  const supabase = createCachedReadClient();

  const { data: latest } = await supabase
    .from("player_market_snapshots")
    .select("snapshot_date")
    .eq("source", MARKET_SOURCE)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const date = latest?.snapshot_date ?? null;
  if (!date) return { key: null, date: null, map: {} };

  // Keys are internal constants, never user input.
  for (const key of adpFormatKeyCandidates(formatSlug, "everyone")) {
    const map: Record<string, number> = {};
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("player_market_snapshots")
        .select(`sleeper_player_id, adp_value:adp->>${key}`)
        .eq("source", MARKET_SOURCE)
        .eq("snapshot_date", date)
        .not(`adp->>${key}`, "is", null)
        // The order is not cosmetic. Paging an unordered query lets Postgres
        // return the rows in a different sequence per page, which silently
        // duplicates some players and drops others. This market runs past 1600
        // rows, so it pages every time.
        .order("sleeper_player_id")
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      for (const row of data as unknown as {
        sleeper_player_id: string;
        adp_value: string | null;
      }[]) {
        const value = Number(row.adp_value);
        if (Number.isFinite(value) && value > 0) map[row.sleeper_player_id] = value;
      }
      if (data.length < PAGE) break;
    }
    if (Object.keys(map).length > 0) return { key, date, map };
  }

  return { key: null, date, map: {} };
}

/** The ADP map, memoized on the format alone. It does not vary by source. */
function loadAdpMapCached(formatSlug: string): Promise<AdpMap> {
  return unstable_cache(() => loadAdpMap(formatSlug), ["draft-tracker-adp", formatSlug], {
    revalidate: CACHE_TTL.hourly,
    tags: [CACHE_TAGS.playerValues],
  })();
}

async function loadBoard(args: {
  formatConfigId: string;
  formatSlug: string;
  formatLabel: string;
  sourceSlug: string;
  sourceLabel: string;
}): Promise<DraftTrackerBoard> {
  const { formatConfigId, formatSlug, formatLabel, sourceSlug, sourceLabel } = args;
  const supabase = createCachedReadClient();

  const [rankingRows, adp] = await Promise.all([
    (async () => {
      // Rankings are partitioned by season, and the site publishes a season
      // ahead of the calendar. Read the newest partition for this (format,
      // source) rather than every partition at once, or a player would appear
      // twice the day a new season lands. The number is a label, not a
      // freshness signal: values come from the trends table below.
      const { data: latestSeason } = await supabase
        .from("rankings")
        .select("season")
        .eq("format_config_id", formatConfigId)
        .eq("source", sourceSlug)
        .is("week", null)
        .order("season", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latestSeason) return [];

      const rows: RankingRow[] = [];
      for (let from = 0; from < BOARD_LIMIT; from += PAGE) {
        const size = Math.min(PAGE, BOARD_LIMIT - from);
        const { data, error } = await supabase
          .from("rankings")
          .select(
            "overall_rank, position_rank, tier, players!inner(id, first_name, last_name, full_name, position, team, external_ids)",
          )
          .eq("format_config_id", formatConfigId)
          .eq("source", sourceSlug)
          .eq("season", latestSeason.season)
          .is("week", null)
          .order("overall_rank")
          .range(from, from + size - 1);
        if (error || !data || data.length === 0) break;
        rows.push(...(data as unknown as RankingRow[]));
        if (data.length < size) break;
      }
      return rows;
    })(),
    loadAdpMapCached(formatSlug),
  ]);

  if (rankingRows.length === 0) {
    return {
      status: "no-rankings",
      players: [],
      formatSlug,
      formatLabel,
      sourceSlug,
      sourceLabel,
      adpKey: adp.key,
      adpDate: adp.date,
    };
  }

  // Value comes from the pre-calculated trends table rather than from raw
  // history: one row per player per (format, source), so this is a single
  // indexed read instead of a scan over every snapshot ever written.
  const valueByPlayer = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("player_value_trends")
      .select("player_id, current_value")
      .eq("format_config_id", formatConfigId)
      .eq("source", sourceSlug)
      // Ordered for the same reason the ADP read is: a paged query with no
      // order can hand back the same row twice and never hand back another.
      .order("player_id")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      if (typeof row.current_value === "number") {
        valueByPlayer.set(row.player_id, row.current_value);
      }
    }
    if (data.length < PAGE) break;
  }

  const players: TrackerPlayer[] = [];
  for (const row of rankingRows) {
    const p = row.players;
    // The same coercion the position colours use, so a position that survives
    // to the badge lookup always has a class to find.
    const position = normalizePositionColor(p.position);
    if (!position) continue; // IDP and other non-draftable rows

    const name =
      (p.full_name ?? "").trim() || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    if (!name) continue;

    const sleeperId = readSleeperId(p.external_ids);
    players.push({
      playerId: p.id,
      sleeperId,
      name,
      sortName: buildSortName(p.first_name, p.last_name, name),
      position,
      team: p.team,
      overallRank: row.overall_rank,
      positionRank: row.position_rank,
      tier: row.tier,
      value: valueByPlayer.get(p.id) ?? null,
      adp: sleeperId ? (adp.map[sleeperId] ?? null) : null,
    });
  }

  return {
    status: players.length > 0 ? "ok" : "no-rankings",
    players,
    formatSlug,
    formatLabel,
    sourceSlug,
    sourceLabel,
    adpKey: adp.key,
    adpDate: adp.date,
  };
}

/**
 * The board for a (format, source), memoized in the Next data cache.
 *
 * The other three closure arguments are functionally determined by those two
 * through format_configs and source_registry, so no two formats or sources can
 * collide on this key.
 */
export function loadDraftTrackerBoard(args: {
  formatConfigId: string;
  formatSlug: string;
  formatLabel: string;
  sourceSlug: string;
  sourceLabel: string;
}): Promise<DraftTrackerBoard> {
  return unstable_cache(
    () => loadBoard(args),
    ["draft-tracker-board", args.formatConfigId, args.sourceSlug],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerValues] },
  )();
}
