/**
 * player_idp_seasons aggregation (plan IDP-117). Pure: takes weekly defender
 * rows, returns one season row per (player, season, season type).
 *
 * The rows it reads are the typed player_stats columns (migration 0296), and
 * only weeks with a defensive snap recorded count as a game. No points: a
 * season's points depend on a league's scoring, and every consumer scores the
 * stat totals under the preset it names.
 */

export const IDP_SEASON_STAT_COLUMNS = [
  "def_snp",
  "tm_def_snp",
  "idp_tkl",
  "idp_tkl_solo",
  "idp_tkl_ast",
  "idp_tkl_loss",
  "idp_sack",
  "idp_sack_yd",
  "idp_qb_hit",
  "idp_int",
  "idp_int_ret_yd",
  "idp_pass_def",
  "idp_pass_def_3p",
  "idp_ff",
  "idp_fum_rec",
  "idp_fum_ret_yd",
  "idp_def_td",
  "idp_safe",
  "idp_blk_kick",
  "bonus_tkl_10p",
  "bonus_sack_2p",
] as const;

export type IdpSeasonStatColumn = (typeof IDP_SEASON_STAT_COLUMNS)[number];

/** A snap count at or above this is "played a real role" for the search gate. */
export const REAL_ROLE_SNAPS = 20;

export type IdpWeekRow = {
  playerId: string;
  season: number;
  seasonType: "regular" | "post" | "pre";
  position: string;
  eligiblePositions: string[];
  defSnapPct: number | null;
} & Partial<Record<IdpSeasonStatColumn, number | null>>;

export type IdpSeasonRow = {
  player_id: string;
  season: number;
  season_type: "regular" | "post" | "pre";
  position: string;
  eligible_positions: string[];
  games: number;
  games_20_snaps: number;
  avg_def_snap_pct: number | null;
} & Record<IdpSeasonStatColumn, number | null>;

const DEFENDER_POSITIONS = new Set(["DL", "LB", "DB"]);

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : value === null || value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function aggregateIdpSeasons(rows: IdpWeekRow[]): IdpSeasonRow[] {
  type Acc = {
    row: IdpSeasonRow;
    snapPctSum: number;
    snapPctCount: number;
  };
  const byKey = new Map<string, Acc>();
  for (const week of rows) {
    if (!DEFENDER_POSITIONS.has(week.position)) continue;
    const snaps = finite(week.def_snp);
    if (snaps === null) continue;

    const key = `${week.playerId}|${week.season}|${week.seasonType}`;
    let acc = byKey.get(key);
    if (!acc) {
      const empty = Object.fromEntries(IDP_SEASON_STAT_COLUMNS.map((c) => [c, null])) as Record<
        IdpSeasonStatColumn,
        number | null
      >;
      acc = {
        row: {
          player_id: week.playerId,
          season: week.season,
          season_type: week.seasonType,
          position: week.position,
          eligible_positions: week.eligiblePositions.length > 0 ? week.eligiblePositions : [week.position],
          games: 0,
          games_20_snaps: 0,
          avg_def_snap_pct: null,
          ...empty,
        },
        snapPctSum: 0,
        snapPctCount: 0,
      };
      byKey.set(key, acc);
    }

    acc.row.games += 1;
    if (snaps >= REAL_ROLE_SNAPS) acc.row.games_20_snaps += 1;
    const pct = finite(week.defSnapPct);
    if (pct !== null) {
      acc.snapPctSum += pct;
      acc.snapPctCount += 1;
    }
    for (const col of IDP_SEASON_STAT_COLUMNS) {
      const v = finite(week[col]);
      if (v === null) continue;
      acc.row[col] = (acc.row[col] ?? 0) + v;
    }
  }

  return [...byKey.values()].map(({ row, snapPctSum, snapPctCount }) => ({
    ...row,
    avg_def_snap_pct: snapPctCount > 0 ? Math.round((snapPctSum / snapPctCount) * 10000) / 10000 : null,
  }));
}
