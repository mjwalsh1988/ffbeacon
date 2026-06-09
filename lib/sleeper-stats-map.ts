/**
 * Maps a Sleeper weekly stats payload (the flat per-player object returned by
 * /v1/stats/nfl/{seasonType}/{season}/{week}) onto our player_stats columns.
 *
 * Most player_stats columns are Sleeper-native stat keys, so the bulk of the
 * mapping is a verbatim key copy. Two rules protect data integrity:
 *
 *  - Counting columns are NOT NULL in the schema. An absent key means the
 *    player did not accumulate that stat that week, so 0 is the correct value.
 *  - Rate / context columns are nullable. An absent key means Sleeper never
 *    recorded it (snap counts are commonly missing for 2016-2018), so we write
 *    NULL, never 0. snap_pct is DERIVED from off_snp / tm_off_snp and stays
 *    NULL whenever either input is missing or the denominator is 0, so a
 *    missing denominator can never produce a 0 or a divide-by-zero.
 *
 * The full raw payload is preserved separately in player_stats.metadata by the
 * caller, so keys we have no column for (pts_ppr, pts_half_ppr, pts_std,
 * pos_rank_*, and any future Sleeper keys) are never lost.
 */

// NOT NULL integer columns: absent key -> 0.
const INT_COLUMNS = [
  "pass_yd", "pass_td", "pass_int", "pass_2pt", "pass_att", "pass_cmp", "pass_inc",
  "pass_fd", "pass_cmp_40p", "pass_td_40p", "pass_sack", "pass_int_td", "pass_rz_att",
  "pass_lng", "pass_td_lng",
  "rush_yd", "rush_td", "rush_2pt", "rush_att", "rush_fd", "rush_btkl", "rush_rz_att",
  "rush_lng", "rush_td_lng",
  "rec", "rec_yd", "rec_td", "rec_2pt", "rec_fd", "rec_drop", "rec_lng", "rec_td_lng",
  "rec_td_40p", "rec_0_4", "rec_5_9", "rec_10_19", "rec_20_29", "rec_30_39", "rec_40p",
  "fum", "fum_lost", "fum_rec", "fum_rec_td",
  "bonus_pass_cmp_25", "bonus_pass_yd_300", "bonus_pass_yd_400", "bonus_rush_yd_100",
  "bonus_rush_yd_200", "bonus_rec_yd_100", "bonus_rec_yd_200", "bonus_rec_wr", "bonus_rec_te",
  "def_td", "safety", "blk_kick", "interceptions", "ff",
  "pts_allow_0", "pts_allow_1_6", "pts_allow_7_13", "pts_allow_14_20", "pts_allow_21_27",
  "pts_allow_28_34", "pts_allow_35p",
  "fga", "fgm", "fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50p", "fgmiss",
  "xpa", "xpm", "xpmiss",
] as const;

// NOT NULL numeric columns: absent key -> 0.
const NUMERIC_COLUMNS = ["pass_air_yd", "rush_yac", "rec_yar", "gp", "gs", "sack"] as const;

// Nullable numeric columns: absent key -> NULL (never 0).
const NULLABLE_NUMERIC_COLUMNS = ["rec_air_yd", "target_share", "off_snp", "tm_off_snp"] as const;

// Nullable integer columns: absent key -> NULL (never 0).
const NULLABLE_INT_COLUMNS = ["rec_tgt", "pts_allow", "yds_allow"] as const;

export type StatRow = Record<string, number | string | null>;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function mapStatPayloadToRow(payload: Record<string, unknown>): StatRow {
  const row: StatRow = {};

  for (const col of INT_COLUMNS) {
    const v = num(payload[col]);
    row[col] = v === null ? 0 : Math.trunc(v);
  }
  for (const col of NUMERIC_COLUMNS) {
    const v = num(payload[col]);
    row[col] = v === null ? 0 : v;
  }
  for (const col of NULLABLE_NUMERIC_COLUMNS) {
    row[col] = num(payload[col]);
  }
  for (const col of NULLABLE_INT_COLUMNS) {
    const v = num(payload[col]);
    row[col] = v === null ? null : Math.trunc(v);
  }

  // snap_pct: derived, NULL-safe. Missing snap data (common pre-2019) or a zero
  // team-snap denominator yields NULL, not 0, and never divides by zero.
  const offSnp = num(payload.off_snp);
  const tmOffSnp = num(payload.tm_off_snp);
  row.snap_pct = offSnp !== null && tmOffSnp !== null && tmOffSnp > 0 ? offSnp / tmOffSnp : null;

  // The weekly stats endpoint does not carry game context, so these stay NULL.
  row.opponent = null;
  row.game_id = null;

  return row;
}
